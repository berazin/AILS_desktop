"""The geometric line order used to assemble indexed page text."""
import statistics


def page_word_lines(words):
    if not words:
        return []
    words = sorted(words, key=lambda word: ((word.top + word.bottom) / 2, word.left))
    median_height = max(1e-6, statistics.median(word.bottom - word.top for word in words))
    lines = []
    for word in words:
        center = (word.top + word.bottom) / 2
        if not lines or abs(center - statistics.mean((item.top + item.bottom) / 2 for item in lines[-1])) > median_height * 0.65:
            lines.append([word])
        else:
            lines[-1].append(word)
    return [sorted(line, key=lambda item: item.left) for line in lines]
