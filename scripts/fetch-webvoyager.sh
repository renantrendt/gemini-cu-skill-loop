#!/usr/bin/env bash
# Pull WebVoyager's published task list + reference answers.
# Source:   https://github.com/MinorJerry/WebVoyager  (MIT licensed)
# Lands in: webvoyager_data/ (gitignored).
set -euo pipefail
mkdir -p webvoyager_data
cd webvoyager_data
curl -sSL -O https://raw.githubusercontent.com/MinorJerry/WebVoyager/main/data/WebVoyager_data.jsonl
curl -sSL -O https://raw.githubusercontent.com/MinorJerry/WebVoyager/main/data/reference_answer.json
wc -l WebVoyager_data.jsonl reference_answer.json
