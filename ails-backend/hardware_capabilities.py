from __future__ import annotations

import ctypes
import importlib.util
import os

from common import resource_path
from local_inference import GPU_SCHEDULER
from ocr_runtime import packaged_ocr_runtime_root


VK_SUCCESS = 0
VK_STRUCTURE_TYPE_APPLICATION_INFO = 0
VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO = 1
VK_MEMORY_HEAP_DEVICE_LOCAL_BIT = 0x1
VK_MAX_MEMORY_TYPES = 32
VK_MAX_MEMORY_HEAPS = 16


class VkApplicationInfo(ctypes.Structure):
    _fields_ = [
        ("sType", ctypes.c_uint32),
        ("pNext", ctypes.c_void_p),
        ("pApplicationName", ctypes.c_char_p),
        ("applicationVersion", ctypes.c_uint32),
        ("pEngineName", ctypes.c_char_p),
        ("engineVersion", ctypes.c_uint32),
        ("apiVersion", ctypes.c_uint32),
    ]


class VkInstanceCreateInfo(ctypes.Structure):
    _fields_ = [
        ("sType", ctypes.c_uint32),
        ("pNext", ctypes.c_void_p),
        ("flags", ctypes.c_uint32),
        ("pApplicationInfo", ctypes.POINTER(VkApplicationInfo)),
        ("enabledLayerCount", ctypes.c_uint32),
        ("ppEnabledLayerNames", ctypes.c_void_p),
        ("enabledExtensionCount", ctypes.c_uint32),
        ("ppEnabledExtensionNames", ctypes.c_void_p),
    ]


class VkMemoryType(ctypes.Structure):
    _fields_ = [("propertyFlags", ctypes.c_uint32), ("heapIndex", ctypes.c_uint32)]


class VkMemoryHeap(ctypes.Structure):
    _fields_ = [("size", ctypes.c_uint64), ("flags", ctypes.c_uint32)]


class VkPhysicalDeviceMemoryProperties(ctypes.Structure):
    _fields_ = [
        ("memoryTypeCount", ctypes.c_uint32),
        ("memoryTypes", VkMemoryType * VK_MAX_MEMORY_TYPES),
        ("memoryHeapCount", ctypes.c_uint32),
        ("memoryHeaps", VkMemoryHeap * VK_MAX_MEMORY_HEAPS),
    ]


def _vulkan_version(value: int) -> str:
    return f"{value >> 22}.{(value >> 12) & 0x3ff}.{value & 0xfff}"


def _vendor_name(vendor_id: int) -> str:
    return {
        0x1002: "AMD",
        0x1022: "AMD",
        0x10DE: "NVIDIA",
        0x8086: "Intel",
        0x5143: "Qualcomm",
    }.get(vendor_id, f"0x{vendor_id:04X}")


def _device_priority(device: dict) -> tuple[int, int]:
    type_priority = {2: 4, 1: 3, 3: 2, 0: 1, 4: 0}
    return type_priority.get(int(device["device_type"]), 0), int(device["device_memory_bytes"])


def detect_vulkan_capabilities() -> dict:
    if os.name != "nt":
        return {"available": False, "devices": [], "selected_device": None, "error": "Windows only"}
    try:
        vulkan = ctypes.WinDLL("vulkan-1.dll")
    except OSError as error:
        return {"available": False, "devices": [], "selected_device": None, "error": str(error)}

    instance = ctypes.c_void_p()
    app_name = b"AILS"
    app_info = VkApplicationInfo(
        VK_STRUCTURE_TYPE_APPLICATION_INFO,
        None,
        app_name,
        1,
        app_name,
        1,
        1 << 22,
    )
    create_info = VkInstanceCreateInfo(
        VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO,
        None,
        0,
        ctypes.pointer(app_info),
        0,
        None,
        0,
        None,
    )
    vulkan.vkCreateInstance.argtypes = [ctypes.POINTER(VkInstanceCreateInfo), ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
    vulkan.vkCreateInstance.restype = ctypes.c_int32
    result = vulkan.vkCreateInstance(ctypes.byref(create_info), None, ctypes.byref(instance))
    if result != VK_SUCCESS:
        return {"available": False, "devices": [], "selected_device": None, "error": f"vkCreateInstance={result}"}

    try:
        vulkan.vkEnumeratePhysicalDevices.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32), ctypes.c_void_p]
        vulkan.vkEnumeratePhysicalDevices.restype = ctypes.c_int32
        count = ctypes.c_uint32()
        if vulkan.vkEnumeratePhysicalDevices(instance, ctypes.byref(count), None) != VK_SUCCESS or count.value < 1:
            return {"available": False, "devices": [], "selected_device": None, "error": "No Vulkan device"}
        handles = (ctypes.c_void_p * count.value)()
        if vulkan.vkEnumeratePhysicalDevices(instance, ctypes.byref(count), handles) != VK_SUCCESS:
            return {"available": False, "devices": [], "selected_device": None, "error": "Device enumeration failed"}

        vulkan.vkGetPhysicalDeviceProperties.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        vulkan.vkGetPhysicalDeviceMemoryProperties.argtypes = [ctypes.c_void_p, ctypes.POINTER(VkPhysicalDeviceMemoryProperties)]
        devices = []
        for index, handle in enumerate(handles):
            properties = ctypes.create_string_buffer(4096)
            vulkan.vkGetPhysicalDeviceProperties(handle, properties)
            api_version = ctypes.c_uint32.from_buffer(properties, 0).value
            vendor_id = ctypes.c_uint32.from_buffer(properties, 8).value
            device_id = ctypes.c_uint32.from_buffer(properties, 12).value
            device_type = ctypes.c_uint32.from_buffer(properties, 16).value
            name = bytes(properties[20:276]).split(b"\0", 1)[0].decode("utf-8", errors="replace")
            memory = VkPhysicalDeviceMemoryProperties()
            vulkan.vkGetPhysicalDeviceMemoryProperties(handle, ctypes.byref(memory))
            local_memory = sum(
                int(memory.memoryHeaps[heap_index].size)
                for heap_index in range(min(memory.memoryHeapCount, VK_MAX_MEMORY_HEAPS))
                if memory.memoryHeaps[heap_index].flags & VK_MEMORY_HEAP_DEVICE_LOCAL_BIT
            )
            devices.append({
                "index": index,
                "name": name,
                "vendor": _vendor_name(vendor_id),
                "vendor_id": vendor_id,
                "device_id": device_id,
                "device_type": device_type,
                "api_version": _vulkan_version(api_version),
                "device_memory_bytes": local_memory,
            })
        selected = max(devices, key=_device_priority) if devices else None
        return {"available": bool(devices), "devices": devices, "selected_device": selected, "error": ""}
    finally:
        vulkan.vkDestroyInstance.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        vulkan.vkDestroyInstance(instance, None)


class HardwareCapabilityService:
    def snapshot(self) -> dict:
        vulkan = detect_vulkan_capabilities()
        whisper_ready = os.path.isfile(
            resource_path(os.path.join("tools", "whispercpp-vulkan", "whisper-cli.exe"))
        )
        ocr_ready = importlib.util.find_spec("paddleocr") is not None and (
            importlib.util.find_spec("onnxruntime") is not None
            or packaged_ocr_runtime_root() is not None
        )
        return {
            "platform": "windows" if os.name == "nt" else os.name,
            "vulkan": vulkan,
            "voice": {
                "backend": "Windows Speech online / Sherpa + whisper.cpp offline",
                "execution_provider": "Vulkan" if vulkan["available"] else "CPU",
                "ready": whisper_ready,
                "model": "Hardware-selected 1-pass or 2-pass STT",
            },
            "ocr": {
                "backend": "PaddleOCR PP-OCRv6 / ONNX Runtime",
                "preferred_provider": "CUDA -> OpenVINO -> DirectML",
                "cpu_fallback": True,
                "ready": ocr_ready,
            },
            "stt": {
                "backend": "whisper.cpp",
                "preferred_provider": "Vulkan",
                "cpu_fallback": True,
                "ready": whisper_ready,
            },
            "gpu_scheduler": GPU_SCHEDULER.status(),
        }
