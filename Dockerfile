# Python Discord bot runtime.
# Replaces the prior NIXPACKS auto-detect (which picked Node from
# package.json instead of Python from requirements.txt).

FROM python:3.11-slim

WORKDIR /app

# System deps for Pillow + psycopg
RUN apt-get update && apt-get install -y --no-install-recommends \
        libjpeg-dev zlib1g-dev libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY . /app/

CMD ["python", "-m", "python.discord_bot"]
