import os
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()
api_key = os.environ.get("GOOGLE_API_KEY")

if not api_key:
    print("API Key tidak ditemukan di .env")
else:
    genai.configure(api_key=api_key)
    print("Model yang tersedia untuk API Key ini:")
    for m in genai.list_models():
        if 'generateContent' in m.supported_generation_methods:
            print(f"- {m.name}")
