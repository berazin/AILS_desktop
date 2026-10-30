"""Compatibility for public API methods while services own their state.

Only adapters and the composition root use this module. Services receive their
named ports, never the facade or this registry.
"""
import threading

_registry_lock = threading.RLock()


def services_for(facade):
    with _registry_lock:
        services = facade.__dict__.get("_services")
        if services is None:
            from bootstrap.services import compose_services
            services = compose_services(facade)
            facade.__dict__["_services"] = services
        return services


def service_for(facade, name):
    return services_for(facade).get(name)


def service_call(facade, service, method, /, *args, **kwargs):
    # Routing arguments must not consume a service's keyword arguments, such
    # as the HTTP method forwarded by managed authentication requests.
    from contextlib import nullcontext
    runtime = facade.__dict__.get("search_runtime")
    with runtime.scope() if runtime is not None else nullcontext():
        return getattr(service_for(facade, service), method)(*args, **kwargs)


class ServiceAttribute:
    """Keep a former API field available without creating a second state copy."""

    def __init__(self, service, name):
        self.service = service
        self.name = name

    def __get__(self, facade, owner=None):
        if facade is None:
            return self
        return getattr(service_for(facade, self.service), self.name)

    def __set__(self, facade, value):
        setattr(service_for(facade, self.service), self.name, value)
