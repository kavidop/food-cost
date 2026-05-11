from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    db_path: str = str(Path(__file__).parent.parent.parent / "zubro_food_cost.db")
    database_url: str = ""
    pdf_dir: str = str(Path(__file__).parent.parent.parent / "pdfs")
    anthropic_api_key: str = ""
    google_api_key: str = ""
    debug: bool = True

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
