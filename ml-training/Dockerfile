FROM python:3.12-slim

WORKDIR /workspace

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy and install python dependencies (constraints.txt pins transitive versions; see requirements.txt)
COPY requirements.txt constraints.txt .
RUN pip install --no-cache-dir -r requirements.txt -c constraints.txt

# Create cache directory for HuggingFace models
RUN mkdir -p /workspace/.cache/huggingface && chmod 777 /workspace/.cache/huggingface

EXPOSE 8888
