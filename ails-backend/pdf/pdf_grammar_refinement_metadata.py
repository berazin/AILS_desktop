"""Product policy version and provenance, independent of Kiwi releases."""

from pdf.pdf_analysis_metadata import utc_now_iso

GRAMMAR_REFINEMENT_VERSION = "0.8"
GRAMMAR_REFINEMENT_ENGINE = "Kiwi+Ourmalsam"
KIWI_VERSION = "0.24.0"
GRAMMAR_METADATA_KEY = "/AILSGrammarRefinement"


def refinement_is_current(record):
    return (isinstance(record, dict) and str(record.get("version")) == GRAMMAR_REFINEMENT_VERSION
            and record.get("status") == "complete")


def read_refinement_metadata(path):
    from pdf.pdf_password import open_pdf_reader
    from pdf.pdf_analysis_metadata import _header_from_value
    with open(path, "rb") as source:
        return _header_from_value((open_pdf_reader(source).metadata or {}).get(GRAMMAR_METADATA_KEY))


def grammar_metadata(statuses):
    statuses = list(statuses)
    status = "complete" if statuses and all(s == "complete" for s in statuses) else (
        "disabled" if statuses and all(s == "disabled" for s in statuses) else "incomplete")
    return {"version": GRAMMAR_REFINEMENT_VERSION, "engine": GRAMMAR_REFINEMENT_ENGINE,
            "status": status, "created_at": utc_now_iso()}
