"""Warm provider prefixes with real visual work before bounded parallel calls."""

from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

from common import append_status_log


def iter_visual_analysis(items, analyze, *, model_identity, concurrency, check_cancel, log_list):
    """Yield results for checkpointing before releasing dependent requests.

    Local result reuse is not a provider request. DeepSeek discovers a common
    prefix from two different inputs; explicit OpenAI prefixes need one input.
    No dummy requests, synthetic cache hits, or unbounded warmup retries.
    """
    items = list(items)
    next_index = 0
    if concurrency > 1 and len(items) > 1:
        append_status_log(log_list, "공통 입력 캐시 재사용을 위해 초기 구간을 순차 분석합니다.")
        warm_count = 0
        warm_target = 2 if "deepseek" in str(model_identity).lower() else 1
        while next_index < len(items) and warm_count < warm_target:
            check_cancel()
            item = items[next_index]
            result = analyze(item)
            yield item, result  # Caller saves paid results before we proceed.
            next_index += 1
            records = result[2]
            called = not isinstance(records, list) or any(
                record.get("attempt") != "prior" for record in records)
            if called:
                warm_count += 1
                # Managed defaults can resolve to a concrete model on first use.
                model = str(result[1] or model_identity).lower()
                warm_target = 2 if "deepseek" in model else 1
        check_cancel()
    if next_index == len(items):
        return
    check_cancel()
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        pending = {}
        failure = None
        def fill_workers():
            nonlocal next_index
            while next_index < len(items) and len(pending) < concurrency:
                item = items[next_index]
                pending[executor.submit(analyze, item)] = item
                next_index += 1
        fill_workers()
        while pending:
            if failure is None:
                try:
                    check_cancel()
                except Exception as error:
                    failure = error
            done, _ = wait(pending, timeout=0.5, return_when=FIRST_COMPLETED)
            for future in done:
                item = pending.pop(future)
                try:
                    result = future.result()
                except Exception as error:
                    if failure is None:
                        failure = error
                        append_status_log(log_list, "영상 분석 요청 실패: 진행 중 응답을 저장한 뒤 중단합니다.")
                else:
                    yield item, result
            # Do not send the whole video in advance. Once one request fails,
            # drain already-paid peers so the caller can checkpoint every result.
            if failure is None:
                fill_workers()
        if failure is not None:
            raise failure
