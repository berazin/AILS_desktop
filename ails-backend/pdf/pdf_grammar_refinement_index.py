"""Restore derived OCR page text after extracting the unchanged PDF streams."""


def apply_embedded_ocr_refinement(path, connection):
    import hashlib
    from pdf.pdf_analysis_metadata import read_analysis_metadata, _header_from_value
    from pdf.pdf_password import open_pdf_reader
    from pdf.pdf_grammar_refinement_metadata import GRAMMAR_METADATA_KEY, refinement_is_current

    with open(path, "rb") as source:
        reader = open_pdf_reader(source)
        info_record = _header_from_value((reader.metadata or {}).get(GRAMMAR_METADATA_KEY))
        if not refinement_is_current(info_record):
            return
        stored = read_analysis_metadata(reader) or {}
        payload = stored.get("payload")
        if not isinstance(payload, dict) or payload.get("grammar_refinement") != info_record:
            return
        if (stored.get("header") or {}).get("grammar_refinement") != info_record:
            return
        pages = payload.get("pages")
        if not isinstance(pages, list):
            return
        for page in pages:
            if not isinstance(page, dict) or not isinstance(page.get("text"), str):
                continue
            number = page.get("page")
            if not isinstance(number, int) or not 1 <= number <= len(reader.pages):
                continue
            if not page.get("refinement_stream_sha256") or not page.get("refinement_extracted_nonspace_sha256"):
                continue
            physical_page = reader.pages[number - 1]
            contents = physical_page.get_contents()
            stream_digest = hashlib.sha256(contents.get_data() if contents is not None else b"").hexdigest()
            if page["refinement_stream_sha256"] != stream_digest:
                continue
            text_digest = hashlib.sha256("".join(physical_page.extract_text().split()).encode("utf-8")).hexdigest()
            if page["refinement_extracted_nonspace_sha256"] != text_digest:
                continue
            _restore_validated_blocks(path, number, page.get("blocks") or [], connection)
            connection.execute("UPDATE pdf_ocr_pages SET text = ? WHERE path = ? AND page = ?",
                               (page["text"], path, number))


def _restore_validated_blocks(path, number, blocks, connection):
    """Reload optional spacing JSON from the already validated PDF attachment.

    Stream extraction has no structural blocks. Restore their original normalized
    geometry from the attachment; existing OCR word rows are never rewritten.
    """
    import json
    import math
    for block in blocks:
        if not isinstance(block, dict):
            raise ValueError("invalid stored OCR block")
        block_id = block["block_id"]
        existing = connection.execute(
            "SELECT text FROM pdf_ocr_blocks WHERE path = ? AND page = ? AND block_id = ?",
            (path, number, block_id)).fetchone()
        text = str(block.get("text") or "")
        spacing = block.get("spacing") or {}
        if existing is not None:
            if "".join(str(existing[0]).split()) != "".join(text.split()):
                raise ValueError("stored OCR block character invariant violated")
            connection.execute("UPDATE pdf_ocr_blocks SET text = ?, spacing_json = ? WHERE path = ? AND page = ? AND block_id = ?",
                               (text, json.dumps(spacing, ensure_ascii=False), path, number, block_id))
            continue
        bbox = block["normalized_bbox"]
        if len(bbox) != 4 or not all(math.isfinite(float(value)) for value in bbox):
            raise ValueError("invalid stored OCR block geometry")
        connection.execute(
            "INSERT INTO pdf_ocr_blocks(path,page,block_id,type,left,top,right,bottom,reading_order,confidence,text_source,text,table_json,formula_json,spacing_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (path, number, block_id, block["type"], *bbox, block["reading_order"], block["confidence"],
             block.get("text_source") or "ocr", text, json.dumps(block.get("table") or {}, ensure_ascii=False),
             json.dumps(block.get("formula") or {}, ensure_ascii=False), json.dumps(spacing, ensure_ascii=False)))
