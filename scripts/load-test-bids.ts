/**
 * Load test script for bid placement operations
 * 
 * Usage:
 *   npx ts-node scripts/load-test-bids.ts
 * 
 * Prerequisites:
 *   - Running backend server (npm run start:dev)
 *   - Running MongoDB, Redis, RabbitMQ (npm run test:docker:up)
 *   - Test data created via API or test setup
 * 
 * Environment variables:
 *   - API_URL: Backend API URL (default: http://localhost:3000)
 *   - CONCURRENT_USERS: Number of concurrent users (default: 10)
 *   - REQUESTS_PER_USER: Number of requests per user (default: 5)
 *   - AUCTION_ID: Auction ID to test against (required)
 */

import * as http from 'http';
import * as https from 'https';

interface LoadTestConfig {
  apiUrl: string;
  concurrentUsers: number;
  requestsPerUser: number;
  auctionId: string;
}

interface TestResult {
  userId: string;
  requestIndex: number;
  success: boolean;
  statusCode: number;
  responseTime: number;
  error?: string;
}

interface TestSummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  p95ResponseTime: number;
  requestsPerSecond: number;
  totalDuration: number;
}

const config: LoadTestConfig = {
  apiUrl: process.env.API_URL || 'http://localhost:3000',
  concurrentUsers: parseInt(process.env.CONCURRENT_USERS || '10', 10),
  requestsPerUser: parseInt(process.env.REQUESTS_PER_USER || '5', 10),
  auctionId: process.env.AUCTION_ID || '',
};

async function makeRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: object,
): Promise<{ statusCode: number; body: string; responseTime: number }> {
  const startTime = Date.now();
  const urlObj = new URL(url);
  const isHttps = urlObj.protocol === 'https:';
  const httpModule = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = httpModule.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          body: data,
          responseTime: Date.now() - startTime,
        });
      });
    });

    req.on('error', (error) => reject(error));

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function loginUser(telegramId: number, password: string): Promise<string> {
  const response = await makeRequest(
    `${config.apiUrl}/auth/password`,
    'POST',
    {},
    { telegramId, password },
  );

  if (response.statusCode !== 201) {
    throw new Error(`Login failed: ${response.body}`);
  }

  const data = JSON.parse(response.body);
  return data.accessToken;
}

async function placeBid(
  token: string,
  auctionId: string,
  amount: number,
): Promise<{ statusCode: number; responseTime: number; body: string }> {
  return makeRequest(
    `${config.apiUrl}/bids/set_bid`,
    'POST',
    { Authorization: `Bearer ${token}` },
    { auctionId, amount },
  );
}

async function runUserSimulation(
  userId: string,
  telegramId: number,
  baseAmount: number,
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  try {
    // Login
    const token = await loginUser(telegramId, 'test-password');

    // Place multiple bids
    for (let i = 0; i < config.requestsPerUser; i++) {
      const amount = baseAmount + i * 10; // Increase bid each time
      const startTime = Date.now();

      try {
        const response = await placeBid(token, config.auctionId, amount);
        results.push({
          userId,
          requestIndex: i,
          success: response.statusCode === 201,
          statusCode: response.statusCode,
          responseTime: response.responseTime,
          error: response.statusCode !== 201 ? response.body : undefined,
        });
      } catch (error) {
        results.push({
          userId,
          requestIndex: i,
          success: false,
          statusCode: 0,
          responseTime: Date.now() - startTime,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      // Small delay between requests from same user
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } catch (error) {
    // Login failed
    for (let i = 0; i < config.requestsPerUser; i++) {
      results.push({
        userId,
        requestIndex: i,
        success: false,
        statusCode: 0,
        responseTime: 0,
        error: `Login failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  return results;
}

function calculateSummary(results: TestResult[], totalDuration: number): TestSummary {
  const responseTimes = results.map((r) => r.responseTime).sort((a, b) => a - b);
  const successfulRequests = results.filter((r) => r.success).length;

  const p95Index = Math.floor(responseTimes.length * 0.95);

  return {
    totalRequests: results.length,
    successfulRequests,
    failedRequests: results.length - successfulRequests,
    avgResponseTime: responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length,
    minResponseTime: responseTimes[0] || 0,
    maxResponseTime: responseTimes[responseTimes.length - 1] || 0,
    p95ResponseTime: responseTimes[p95Index] || 0,
    requestsPerSecond: results.length / (totalDuration / 1000),
    totalDuration,
  };
}

function printSummary(summary: TestSummary): void {
  console.log('\n========== LOAD TEST SUMMARY ==========\n');
  console.log(`Total Requests:      ${summary.totalRequests}`);
  console.log(`Successful:          ${summary.successfulRequests} (${((summary.successfulRequests / summary.totalRequests) * 100).toFixed(1)}%)`);
  console.log(`Failed:              ${summary.failedRequests} (${((summary.failedRequests / summary.totalRequests) * 100).toFixed(1)}%)`);
  console.log(`\nResponse Times:`);
  console.log(`  Average:           ${summary.avgResponseTime.toFixed(2)}ms`);
  console.log(`  Min:               ${summary.minResponseTime}ms`);
  console.log(`  Max:               ${summary.maxResponseTime}ms`);
  console.log(`  P95:               ${summary.p95ResponseTime}ms`);
  console.log(`\nThroughput:`);
  console.log(`  Requests/sec:      ${summary.requestsPerSecond.toFixed(2)}`);
  console.log(`  Total Duration:    ${(summary.totalDuration / 1000).toFixed(2)}s`);
  console.log('\n========================================\n');
}

function printErrors(results: TestResult[]): void {
  const errors = results.filter((r) => !r.success && r.error);
  if (errors.length === 0) return;

  console.log('\n========== ERRORS ==========\n');
  
  // Group errors by message
  const errorGroups = new Map<string, number>();
  for (const error of errors) {
    const key = error.error || 'Unknown';
    errorGroups.set(key, (errorGroups.get(key) || 0) + 1);
  }

  for (const [message, count] of errorGroups) {
    console.log(`[${count}x] ${message.substring(0, 200)}`);
  }
  console.log('\n============================\n');
}

async function main(): Promise<void> {
  console.log('========== LOAD TEST CONFIG ==========');
  console.log(`API URL:             ${config.apiUrl}`);
  console.log(`Concurrent Users:    ${config.concurrentUsers}`);
  console.log(`Requests per User:   ${config.requestsPerUser}`);
  console.log(`Auction ID:          ${config.auctionId || '(not set)'}`);
  console.log('=======================================\n');

  if (!config.auctionId) {
    console.error('ERROR: AUCTION_ID environment variable is required');
    console.error('Usage: AUCTION_ID=<id> npx ts-node scripts/load-test-bids.ts');
    process.exit(1);
  }

  console.log('Starting load test...\n');

  const startTime = Date.now();

  // Create user simulations
  const userPromises: Promise<TestResult[]>[] = [];
  for (let i = 0; i < config.concurrentUsers; i++) {
    const telegramId = 1000000 + i; // Unique telegram IDs
    const baseAmount = 100 + i * 100; // Different base amounts to avoid conflicts
    userPromises.push(runUserSimulation(`user-${i}`, telegramId, baseAmount));
  }

  // Run all users concurrently
  const allResults = await Promise.all(userPromises);
  const flatResults = allResults.flat();

  const totalDuration = Date.now() - startTime;

  // Calculate and print summary
  const summary = calculateSummary(flatResults, totalDuration);
  printSummary(summary);
  printErrors(flatResults);

  // Exit with error code if too many failures
  if (summary.failedRequests / summary.totalRequests > 0.1) {
    console.error('WARNING: More than 10% of requests failed!');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Load test failed:', error);
  process.exit(1);
});
