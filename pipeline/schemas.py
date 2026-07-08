import re
from typing import List, Tuple
from pydantic import BaseModel, Field, field_validator

# TS: export type Sentiment = "pos" | "neu" | "neg";
# TS: export type EntityType = "PER" | "ORG" | "LOC";

class MetaModel(BaseModel):
    source_name: str
    collected_at: str  # ISO 8601
    date_from: str     # YYYY-MM-DD
    date_to: str       # YYYY-MM-DD
    article_count: int
    cluster_count: int

    @field_validator("date_from", "date_to")
    @classmethod
    def validate_date_format(cls, v: str) -> str:
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", v):
            raise ValueError("Date must be in YYYY-MM-DD format")
        return v

class EntityModel(BaseModel):
    name: str
    type: str  # PER | ORG | LOC

    @field_validator("type")
    @classmethod
    def validate_entity_type(cls, v: str) -> str:
        if v not in ("PER", "ORG", "LOC"):
            raise ValueError("Entity type must be 'PER', 'ORG', or 'LOC'")
        return v

class ArticleModel(BaseModel):
    id: str  # aXXXX
    title: str
    url: str
    press: str
    published_at: str  # YYYY-MM-DD
    category: str
    summary3: Tuple[str, str, str]  # Exact 3 items
    topic_tags: List[str]  # 1 to 3 items
    sentiment: str  # pos | neu | neg
    keywords: List[str]  # 3 to 5 items
    entities: List[EntityModel]
    cluster_id: int
    x: float
    y: float

    @field_validator("id")
    @classmethod
    def validate_id_format(cls, v: str) -> str:
        if not re.match(r"^a\d{4}$", v):
            raise ValueError("Article id must match format 'aXXXX' (e.g. a0001)")
        return v

    @field_validator("published_at")
    @classmethod
    def validate_published_date(cls, v: str) -> str:
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", v):
            raise ValueError("published_at must be in YYYY-MM-DD format")
        return v

    @field_validator("sentiment")
    @classmethod
    def validate_sentiment_enum(cls, v: str) -> str:
        if v not in ("pos", "neu", "neg"):
            raise ValueError("sentiment must be 'pos', 'neu', or 'neg'")
        return v

    @field_validator("topic_tags")
    @classmethod
    def validate_topic_tags_count(cls, v: List[str]) -> List[str]:
        if not (1 <= len(v) <= 3):
            raise ValueError("topic_tags count must be between 1 and 3")
        return v

    @field_validator("keywords")
    @classmethod
    def validate_keywords_count(cls, v: List[str]) -> List[str]:
        if not (3 <= len(v) <= 5):
            raise ValueError("keywords count must be between 3 and 5")
        return v

class CentroidModel(BaseModel):
    x: float
    y: float

class SentimentDistModel(BaseModel):
    pos: int
    neu: int
    neg: int

class ClusterModel(BaseModel):
    id: int
    label: str
    summary: str
    keywords: List[str]  # 3 to 5 items
    size: int
    centroid: CentroidModel
    sentiment_dist: SentimentDistModel

    @field_validator("keywords")
    @classmethod
    def validate_cluster_keywords_count(cls, v: List[str]) -> List[str]:
        if not (3 <= len(v) <= 5):
            raise ValueError("Cluster keywords count must be between 3 and 5")
        return v

class TrendPointModel(BaseModel):
    date: str  # YYYY-MM-DD
    count: int

    @field_validator("date")
    @classmethod
    def validate_trend_date(cls, v: str) -> str:
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", v):
            raise ValueError("Trend point date must be in YYYY-MM-DD format")
        return v

class TrendModel(BaseModel):
    keyword: str
    series: List[TrendPointModel]

class ArticlesFileModel(BaseModel):
    meta: MetaModel
    clusters: List[ClusterModel]
    articles: List[ArticleModel]
    trends: List[TrendModel]

class EmbeddingItemModel(BaseModel):
    id: str
    v: List[float]

    @field_validator("id")
    @classmethod
    def validate_embedding_id(cls, v: str) -> str:
        if not re.match(r"^a\d{4}$", v):
            raise ValueError("Embedding item id must match 'aXXXX'")
        return v

    @field_validator("v")
    @classmethod
    def validate_embedding_vector(cls, v: List[float]) -> List[float]:
        if len(v) != 512:
            raise ValueError("Embedding vector length must be exactly 512")
        return v

class EmbeddingsFileModel(BaseModel):
    model: str
    dim: int
    items: List[EmbeddingItemModel]
