import json
from typing import Any


async def publish_article_update(redis, query_id: str, **data: Any) -> None:
    await redis.publish(
        f"query:{query_id}",
        json.dumps({"type": "article.updated", **data}, ensure_ascii=False),
    )


async def publish_query_status(redis, query_id: str, status: str) -> None:
    await redis.publish(
        f"query:{query_id}",
        json.dumps({"type": "query.status", "query_id": query_id, "status": status}, ensure_ascii=False),
    )
