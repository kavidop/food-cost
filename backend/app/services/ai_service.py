import base64
import json
import re
import tempfile
import os
from pathlib import Path

import fitz  # PyMuPDF

from ..config import settings

EXTRACT_PROMPT = """
You are an expert at reading supplier invoices (including Greek-language ones).
A single PDF may contain MULTIPLE separate invoices. Extract every invoice and
return ONLY this JSON — no markdown, no explanation:

{
  "invoices": [
    {
      "invoice_type":   "invoice|credit_note",
      "invoice_number": "string",
      "invoice_date":   "YYYY-MM-DD",
      "supplier": {
        "name":       "legal entity name",
        "trade_name": "trade/brand name or null",
        "vat_number": "tax/VAT registration number or null",
        "phone":      "phone or null",
        "address":    "full address or null"
      },
      "net_amount":         number,
      "vat_amount":         number,
      "excise_duty_amount": number,
      "gross_amount":       number,
      "line_items": [
        {
          "supplier_sku":         "product code printed on invoice or null",
          "description":          "full product name as printed",
          "quantity":             number,
          "unit":                 "btl|can|kg|L|pcs|kbt",
          "unit_price":           number,
          "discount_percent":     number,
          "line_net_amount":      number,
          "vat_rate":             number,
          "excise_duty_per_unit": number,
          "line_gross_amount":    number
        }
      ]
    }
  ]
}

Rules:
- Each distinct document number = one separate invoice
- Always return the "invoices" array even if only one invoice is found
- invoice_type: use "credit_note" if the document is a ΠΙΣΤΩΤΙΚΟ ΤΙΜΟΛΟΓΙΟ (credit note / credit invoice) or any document that reverses/credits a prior purchase; otherwise use "invoice"
- Dates → ISO-8601 (YYYY-MM-DD)
- All monetary values → plain numbers, no currency symbols (always positive, even for credit notes)
- unit: "btl" bottles, "can" cans, "kg" weight, "L" litre, "kbt" boxes, "pcs" other pieces
- Unknown string fields → null; unknown numeric fields → 0
""".strip()


class ExtractionError(Exception):
    def __init__(self, msg: str, raw: str = ""):
        super().__init__(msg)
        self.raw = raw


def _extract_json_object(raw: str) -> str:
    start = raw.find("{")
    if start == -1:
        raise ExtractionError("No JSON object found in model response", raw)

    depth = 0
    in_string = False
    escape = False

    for i, ch in enumerate(raw[start:], start):
        if escape:
            escape = False
            continue
        if ch == "\\" and in_string:
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return raw[start: i + 1]

    raise ExtractionError("Incomplete JSON — response was cut off", raw)


def _parse_json(raw: str) -> dict:
    extracted = _extract_json_object(raw)
    repaired  = re.sub(r",\s*([}\]])", r"\1", extracted)
    try:
        return json.loads(repaired)
    except json.JSONDecodeError as e:
        raise ExtractionError(f"JSON decode error: {e}", raw) from e


def extract_anthropic(pdf_path: str, model: str) -> dict:
    import anthropic

    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set.")

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    doc    = fitz.open(pdf_path)
    parts  = []
    for i, page in enumerate(doc):
        mat = fitz.Matrix(2.0, 2.0)
        pix = page.get_pixmap(matrix=mat)
        b64 = base64.standard_b64encode(pix.tobytes("png")).decode()
        parts.append({"type": "text",  "text": f"--- Page {i + 1} of {len(doc)} ---"})
        parts.append({"type": "image", "source": {
            "type": "base64", "media_type": "image/png", "data": b64,
        }})
    doc.close()
    parts.append({"type": "text", "text": EXTRACT_PROMPT})

    try:
        response = client.messages.create(
            model=model, max_tokens=16000,
            messages=[{"role": "user", "content": parts}],
        )
    except anthropic.APIError as e:
        raise ExtractionError(f"Anthropic API error: {e}") from e

    raw = response.content[0].text
    if response.stop_reason == "max_tokens":
        raise ExtractionError("Response truncated (max_tokens). Try Opus model.", raw)

    return _parse_json(raw)


def extract_gemini(pdf_path: str, model: str) -> dict:
    from google import genai as google_genai
    from google.genai import types as google_types
    from google.genai import errors as google_errors

    if not settings.google_api_key:
        raise RuntimeError("GOOGLE_API_KEY is not set.")

    client = google_genai.Client(api_key=settings.google_api_key)

    try:
        with open(pdf_path, "rb") as fh:
            uploaded = client.files.upload(
                file=fh,
                config=google_types.UploadFileConfig(mime_type="application/pdf"),
            )
    except google_errors.APIError as e:
        raise ExtractionError(f"Gemini API error (upload): {e}") from e

    try:
        response = client.models.generate_content(
            model=model,
            contents=[uploaded, EXTRACT_PROMPT],
        )
    except google_errors.APIError as e:
        raise ExtractionError(f"Gemini API error: {e}") from e
    finally:
        try:
            client.files.delete(name=uploaded.name)
        except Exception:
            pass

    return _parse_json(response.text)


def extract_pdf(pdf_bytes: bytes, provider: str, model: str) -> dict:
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_bytes)
        tmp_path = tmp.name

    try:
        if provider == "gemini":
            data = extract_gemini(tmp_path, model)
        else:
            data = extract_anthropic(tmp_path, model)

        if "invoices" not in data and "invoice_number" in data:
            data = {"invoices": [data]}

        return data
    finally:
        os.unlink(tmp_path)
