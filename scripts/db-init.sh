#!/bin/bash
set -euo pipefail

until pg_isready -h db -U openclaw -d mission_control; do
  sleep 1
done

psql -h db -U openclaw -d mission_control -v ON_ERROR_STOP=1 -f /workspace/db/schema.sql
psql -h db -U openclaw -d mission_control -v ON_ERROR_STOP=1 -f /workspace/db/seed.sql