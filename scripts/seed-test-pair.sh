#!/bin/sh

# wait for redis to be ready
echo "Waiting for Redis to start..."
until redis-cli -h redis -p 6379 ping | grep -q PONG; do
  sleep 1
done

echo "Redis is up! Injecting test pair..."

redis-cli -h redis -p 6379 PUBLISH token-actions '{"action":"create","pair":"0x7cda02bdd7a522c5bc1a2e93d6d54f0cf0399eab","memeTokenAddress":"0x583edb23e5149cdad7618ea02e298ada51b6bbd3","baseTokenAddress":"0x0000000000000000000000000000000000000000","memeTokenDecimals":18,"baseTokenDecimals":18}' > /dev/null

echo "==========================================================="
echo "TEST PAIR INJECTED: 0x7cda02bdd7a522c5bc1a2e93d6d54f0cf0399eab"
echo "To watch live swaps, open a new terminal and run:"
echo "  docker compose exec redis redis-cli SUBSCRIBE swap-buys"
echo "==========================================================="
