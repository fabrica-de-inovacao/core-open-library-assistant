from fastapi import FastAPI, Depends, HTTPException, Header, Body
from pydantic import BaseModel
import httpx
from bs4 import BeautifulSoup
import fitz  # PyMuPDF - handles LaTeX font encodings correctly
from markitdown import MarkItDown
import pytesseract
from pdf2image import convert_from_bytes
import tempfile
import os
import re

app = FastAPI(title="SOL Extractor Worker")

# The expected static token mapped in docker-compose.yml
API_KEY = os.getenv("WORKER_API_KEY", "your_secret_worker_key_here")

class ExtractRequest(BaseModel):
    article_url: str
    force_ocr: bool = False

def verify_token(x_worker_token: str = Header(...)):
    if x_worker_token != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid Worker Token")

# Initializing MarkItDown
md = MarkItDown()

async def download_file(url: str) -> bytes:
    async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
        response = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
        response.raise_for_status()
        return response.content

async def resolve_pdf_url(landing_page_url: str) -> str:
    # Most SOL/OJS articles have a link ending in "view" or pointing to the PDF
    async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
        try:
            response = await client.get(landing_page_url, headers={"User-Agent": "Mozilla/5.0"})
        except (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.ConnectError):
            return None
        if not response.is_success:
            return None
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Typically the PDF link on OJS (which SOL uses) has the class 'obj_galley_link pdf'
        # or points to /download/
        pdf_link_tag = soup.find('a', class_=re.compile("pdf"))
        if not pdf_link_tag:
             pdf_link_tag = soup.find('a', href=re.compile(r"/download/|/view/"))
        
        if pdf_link_tag and pdf_link_tag.get('href'):
            # Convert relative URL to absolute if necessary
            href = pdf_link_tag['href']
            # OJS view page often doesn't serve raw PDF directly, it wraps it in an iframe.
            # but for this MVP let's assume direct /download/ or just trying it.
            return href.replace('/view/', '/download/')

    return None

def extract_with_pymupdf(pdf_bytes: bytes) -> str:
    """Primary extractor. PyMuPDF correctly handles LaTeX Type1/Type3 font encodings."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    text_parts = []
    for page in doc:
        text_parts.append(page.get_text("text"))
    doc.close()
    return "\n".join(text_parts)

def extract_with_markitdown(pdf_bytes: bytes) -> str:
    """Fallback extractor using MarkItDown (pdfminer-based)."""
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as temp_pdf:
        temp_pdf.write(pdf_bytes)
        temp_pdf_path = temp_pdf.name

    try:
        result = md.convert(temp_pdf_path)
        return result.text_content
    finally:
        os.remove(temp_pdf_path)

def extract_with_ocr(pdf_bytes: bytes) -> str:
    # Needs poppler installed on system
    images = convert_from_bytes(pdf_bytes)
    text_content = ""
    for i, image in enumerate(images):
        text = pytesseract.image_to_string(image, lang='por')
        text_content += text + "\n"
    return text_content

async def fallback_extract_abstract(url: str):
    async with httpx.AsyncClient(follow_redirects=True) as client:
        response = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
        if not response.is_success:
            return "Failed to retrieve both PDF and Abstract."
        soup = BeautifulSoup(response.text, 'html.parser')
        # Typical OJS abstract class
        abstract_section = soup.find('section', class_='item abstract')
        if abstract_section:
            return abstract_section.get_text(strip=True)
        return "Abstract not found on page."

@app.post("/extract", dependencies=[Depends(verify_token)])
async def extract_pdf(request: ExtractRequest):
    method_used = "markitdown"
    
    # 1. Try to find actual PDF URL if the current URL is a landing page
    pdf_url = request.article_url
    if not pdf_url.endswith(".pdf"):
        resolved_url = await resolve_pdf_url(pdf_url)
        if resolved_url:
            pdf_url = resolved_url

    try:
        # 2. Download PDF
        pdf_bytes = await download_file(pdf_url)
        
        # 3. Primary extraction (PyMuPDF → handles LaTeX fonts correctly)
        if request.force_ocr:
            text = extract_with_ocr(pdf_bytes)
            method_used = "tesseract_ocr"
        else:
            text = extract_with_pymupdf(pdf_bytes)
            method_used = "pymupdf"

            # 4. Fallback to OCR if PyMuPDF extracts too little text (scanned/image-only PDF)
            if len(text.strip()) < 200:
                text = extract_with_ocr(pdf_bytes)
                method_used = "tesseract_ocr"
                
        return {
            "success": True,
            "method_used": method_used,
            "content_markdown": text,
            "char_count": len(text)
        }
            
    except Exception as e:
        print(f"Error extracting PDF: {e}. Falling back to Abstract.")
        # 5. Ultimate Fallback (Abstract scraping)
        abstract_text = await fallback_extract_abstract(request.article_url)
        return {
            "success": True,
            "method_used": "abstract_scraping",
            "content_markdown": abstract_text,
            "char_count": len(abstract_text)
        }
