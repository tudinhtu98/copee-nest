# Redis Configuration for BullMQ

BullMQ requires Redis to be running for queue processing. This document explains how to set up Redis for the upload queue system.

## Installation

### macOS (using Homebrew)
```bash
brew install redis
brew services start redis
```

### Linux (Ubuntu/Debian)
```bash
sudo apt-get update
sudo apt-get install redis-server
sudo systemctl start redis
sudo systemctl enable redis
```

### Docker
```bash
docker run -d -p 6379:6379 --name redis redis:latest
```

## Configuration

Add the following environment variables to your `.env` file:

```env
# Redis Configuration (optional, defaults shown)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

If you're using a remote Redis instance or Redis Cloud, update these values accordingly.

## Verification

To verify Redis is running:

```bash
redis-cli ping
```

You should see `PONG` as the response.

## Queue Processing

Once Redis is running and the NestJS application is started, the upload queue will automatically:

- Process jobs in parallel (configurable concurrency)
- Retry failed jobs up to 3 times with exponential backoff
- Store job results for monitoring

## Monitoring

You can monitor the queue using BullMQ Board or Redis CLI:

```bash
# View queue keys
redis-cli KEYS "bull:upload:*"
```

