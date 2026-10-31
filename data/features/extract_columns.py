"""Offline source reader shared by manifest review and regeneration.

Requires pdfplumber 0.11.9, already used by the source extraction workflow.
No runtime/npm dependency. Page/column coordinates refer to the pinned PDF.
"""
import pdfplumber

PAGES = [*range(3, 56), 75]


def read_rows(pdf_path):
    rows = []
    with pdfplumber.open(pdf_path) as pdf:
        for page_number in PAGES:
            for column, (left, right) in enumerate([(48, 310), (320, 578)]):
                words = pdf.pages[page_number - 1].crop((left, 55, right, 735)).extract_words(
                    extra_attrs=['fontname', 'size'], x_tolerance=2)
                lines = []
                for word in sorted(words, key=lambda w: (round(w['top'] / 2) * 2, w['x0'])):
                    if not lines or abs(lines[-1]['y'] - word['top']) > 2:
                        lines.append({'page': page_number, 'col': column, 'y': round(word['top'], 2), 'words': []})
                    lines[-1]['words'].append(word)
                for line in lines:
                    line['words'].sort(key=lambda w: w['x0'])
                    # A font change can split a word (e.g. italic "blas" + roman
                    # "t"). Only insert a space when the PDF has a real gap.
                    text = ''
                    previous = None
                    for word in line['words']:
                        if previous and word['x0'] - previous['x1'] >= 1:
                            text += ' '
                        text += word['text']
                        previous = word
                    line['text'] = text
                    rows.append(line)
    return rows
