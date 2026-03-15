#!/bin/bash
# to start docker: open -a Docker
nohup docker buildx build --platform linux/arm64,linux/amd64 -t docker.io/gonzalomg0/technopoly:latest --push . > build.log 2>&1 &
echo "Build started in background. Log: build.log"