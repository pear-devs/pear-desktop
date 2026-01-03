// Using native fetch instead of Electron's net.fetch because:
// 1. net.fetch/session.fetch restrict Cookie headers (Chromium security)
// 2. Native fetch in Node.js 18+ allows Cookie headers
// 3. This runs in the main process where Node.js fetch is available

/**
 * Standard response format from Slack API endpoints
 *
 * This interface represents the standard response structure returned by all Slack API endpoints.
 * It includes common fields like success status, error information, and the actual response data.
 *
 * @template TData Type of the response data when the call is successful
 *
 * @example
 * ```typescript
 * // Successful response example
 * const successResponse: SlackApiResponse<UserProfile> = {
 *   ok: true,
 *   profile: { display_name: 'John Doe', email: 'john@example.com' }
 * };
 *
 * // Error response example
 * const errorResponse: SlackApiResponse = {
 *   ok: false,
 *   error: 'invalid_auth',
 *   error_description: 'Invalid authentication token'
 * };
 * ```
 */
export interface SlackApiResponse<TData = unknown> {
  /** Whether the API call was successful */
  ok: boolean;

  /** Error code if the call failed (only present when ok is false) */
  error?: string;

  /** Human-readable error description if available (only present when ok is false) */
  error_description?: string;

  /** Warning messages from the API that don't prevent successful execution */
  warning?: string;

  /**
   * Typed response data (available when ok is true)
   * This property is not actually in the Slack API response, but is used
   * to provide type safety for the response data
   */
  data?: TData;

  /**
   * Additional response data properties that vary by endpoint
   * The actual structure depends on the specific API endpoint called
   */
  [key: string]: unknown;
}

/**
 * Parameters for Slack API requests
 *
 * This type represents the parameters that can be passed to Slack API endpoints.
 * It enforces type safety for common parameter types while allowing for flexibility.
 *
 * @example
 * ```typescript
 * const params: SlackApiParams = {
 *   channel: 'C1234567890',
 *   count: 10,
 *   inclusive: true
 * };
 * ```
 */
export type SlackApiParams = {
  [key: string]:
    | string
    | number
    | boolean
    | null
    | undefined
    | string[]
    | number[];
};

/**
 * Error thrown by the Slack API client
 */
export class SlackError extends Error {
  /** The original error that caused this error */
  readonly originalError: Error;
  /** The endpoint that was called */
  readonly endpoint: string;
  /** The HTTP status code if available */
  readonly statusCode?: number;
  /** The response data if available */
  readonly responseData?: SlackApiResponse;

  /**
   * Create a new Slack API error
   * @param message Error message
   * @param endpoint The API endpoint that was called
   * @param originalError The original error that caused this error
   * @param statusCode The HTTP status code if available
   * @param responseData The response data if available
   */
  constructor(
    message: string,
    endpoint: string,
    originalError: Error,
    statusCode?: number,
    responseData?: SlackApiResponse,
  ) {
    super(message);
    this.name = 'SlackError';
    this.originalError = originalError;
    this.endpoint = endpoint;
    this.statusCode = statusCode;
    this.responseData = responseData;
  }
}

/**
 * Cache entry for Slack API responses
 */
interface CacheEntry<T> {
  /** The cached response data */
  data: T;
  /** When the cache entry was created (timestamp) */
  timestamp: number;
  /** Cache expiration time in milliseconds */
  expiryMs: number;
}

/**
 * Rate limit tracking for Slack API endpoints
 */
interface RateLimitInfo {
  /** Number of requests made to this endpoint */
  requestCount: number;
  /** Timestamp when the rate limit window started */
  windowStart: number;
  /** Duration of the rate limit window in milliseconds */
  windowMs: number;
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
}

/**
 * Centralized Slack API client for making requests to the Slack API
 *
 * This client handles authentication, error handling, request formatting,
 * caching, and rate limiting for all Slack API calls in the application.
 *
 * Features:
 * - Automatic request authentication
 * - Response caching for GET requests
 * - Rate limiting protection
 * - Comprehensive error handling
 * - Type-safe request and response handling
 */
export class SlackApiClient {
  /** The Slack API token (xoxc-) */
  readonly token: string;
  /** The Slack cookie token (xoxd-) */
  readonly cookie: string;
  /** Base URL for all Slack API requests */
  private readonly baseUrl = 'https://slack.com/api';
  /** Cache for GET requests to reduce API calls */
  private readonly cache: Map<string, CacheEntry<unknown>> = new Map();
  /** Default cache expiration time (5 minutes) */
  private readonly defaultCacheExpiryMs = 5 * 60 * 1000;
  /** Rate limit tracking for each endpoint */
  private readonly rateLimits: Map<string, RateLimitInfo> = new Map();
  /** Default rate limit (20 requests per minute for most endpoints) */
  private readonly defaultRateLimit = { maxRequests: 20, windowMs: 60 * 1000 };

  /**
   * Create a new Slack API client
   * @param token The Slack API token (xoxc-)
   * @param cookie The Slack cookie token (xoxd-)
   */
  constructor(token: string, cookie: string) {
    this.token = token;
    this.cookie = cookie;
  }

  /**
   * Clear the response cache and reset rate limits
   *
   * This can be useful in scenarios where you want to force fresh data
   * or when testing the API client.
   *
   * @param endpoint Optional specific endpoint to clear. If not provided, clears all endpoints.
   */
  clearCache(endpoint?: string): void {
    if (endpoint) {
      // Clear cache for a specific endpoint
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${endpoint}:`)) {
          this.cache.delete(key);
        }
      }

      // Reset rate limit for the endpoint
      this.rateLimits.delete(endpoint);
    } else {
      // Clear all cache and rate limits
      this.cache.clear();
      this.rateLimits.clear();
    }
  }

  /**
   * Get the base headers required for all Slack API requests
   * @returns Headers object with authentication information
   */
  private getBaseHeaders(): Record<string, string> {
    // Note: Token is sent in request body, not Authorization header
    // This matches how Slack's internal API expects authentication
    // URL-encode the cookie value to handle special characters like + and /
    const encodedCookie = encodeURIComponent(this.cookie);
    return {
      'Cookie': `d=${encodedCookie}`,
    };
  }

  /**
   * Make a POST request to a Slack API endpoint with rate limiting protection
   *
   * This method includes several performance optimizations:
   * 1. Rate limiting protection to prevent hitting Slack API limits
   * 2. Automatic conversion between data formats
   * 3. Comprehensive error handling with detailed error information
   *
   * @param endpoint The API endpoint to call (without the base URL)
   * @param data The data to send in the request body
   * @param formData Whether the data is form data (multipart/form-data)
   * @returns The response from the API
   * @throws {SlackError} If the request fails or would exceed rate limits
   */
  async post<T = unknown>(
    endpoint: string,
    data: Record<string, unknown> | FormData,
    formData = false,
  ): Promise<SlackApiResponse<T>> {
    // Check rate limits before making the request
    if (!this.checkRateLimit(endpoint)) {
      throw new SlackError(
        `Rate limit exceeded for Slack API endpoint: ${endpoint}`,
        endpoint,
        new Error('Too many requests in a short period'),
        429, // HTTP 429 Too Many Requests
        { ok: false, error: 'rate_limited' },
      );
    }

    const url = `${this.baseUrl}/${endpoint}`;
    const headers = this.getBaseHeaders();
    let payload: BodyInit;

    if (formData && data instanceof FormData) {
      // For FormData, add token to the form data
      data.append('token', this.token);
      payload = data;
    } else {
      // For regular POST requests, use URL-encoded format
      headers['Content-Type'] = 'application/x-www-form-urlencoded';

      // Filter out undefined and null values and add token
      const cleanData: Record<string, string> = {
        token: this.token, // Token goes in body, not Authorization header
      };
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null) {
          cleanData[key] = String(value);
        }
      }

      payload = new URLSearchParams(cleanData).toString();
    }

    try {
      // Update rate limit tracking
      this.updateRateLimit(endpoint);

      // Use native fetch (Node.js 18+) which allows Cookie headers
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: payload,
      });
      const json = (await res.json()) as SlackApiResponse<T>;

      if (!json.ok) {
        if (json.error === 'rate_limited') {
          const rateLimit = this.rateLimits.get(endpoint) || {
            requestCount: 0,
            windowStart: Date.now(),
            ...this.defaultRateLimit,
          };
          rateLimit.requestCount = rateLimit.maxRequests;
          this.rateLimits.set(endpoint, rateLimit);
        }
        throw new SlackError(
          `Slack API error: ${json.error || 'Unknown error'}`,
          endpoint,
          new Error(json.error_description || json.error || 'Unknown error'),
          res.status,
          json,
        );
      }
      return json;
    } catch (error: unknown) {
      // Re-throw SlackErrors directly to preserve statusCode and responseData
      if (error instanceof SlackError) {
        throw error;
      }
      throw new SlackError(
        `Error in Slack API POST to ${endpoint}: ${error instanceof Error ? error.message : String(error)}`,
        endpoint,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Check if we're about to exceed rate limits for an endpoint
   * @param endpoint The API endpoint to check
   * @returns True if the request should be allowed, false if it would exceed rate limits
   */
  private checkRateLimit(endpoint: string): boolean {
    const now = Date.now();
    let rateLimit = this.rateLimits.get(endpoint);

    // If no rate limit info exists for this endpoint, create it
    if (!rateLimit) {
      rateLimit = {
        requestCount: 0,
        windowStart: now,
        ...this.defaultRateLimit,
      };
      this.rateLimits.set(endpoint, rateLimit);
    }

    // Check if we need to reset the window
    if (now - rateLimit.windowStart > rateLimit.windowMs) {
      rateLimit.requestCount = 0;
      rateLimit.windowStart = now;
    }

    // Check if we would exceed the rate limit
    return rateLimit.requestCount < rateLimit.maxRequests;
  }

  /**
   * Update rate limit tracking after a request
   * @param endpoint The API endpoint that was called
   */
  private updateRateLimit(endpoint: string): void {
    const rateLimit = this.rateLimits.get(endpoint);
    if (rateLimit) {
      rateLimit.requestCount++;
    }
  }

  /**
   * Generate a cache key for a request
   * @param endpoint The API endpoint
   * @param params The request parameters
   * @returns A unique cache key
   */
  private getCacheKey(endpoint: string, params: SlackApiParams): string {
    return `${endpoint}:${JSON.stringify(params)}`;
  }

  /**
   * Check if a cached response is available and valid
   * @param cacheKey The cache key to check
   * @returns The cached response or undefined if not available
   */
  private getCachedResponse<T>(cacheKey: string): T | undefined {
    const cached = this.cache.get(cacheKey);
    if (!cached) return undefined;

    const now = Date.now();
    const age = now - cached.timestamp;

    // Return the cached data if it's still valid
    if (age < cached.expiryMs) {
      return cached.data as T;
    }

    // Remove expired cache entry
    this.cache.delete(cacheKey);
    return undefined;
  }

  /**
   * Store a response in the cache
   * @param cacheKey The cache key
   * @param data The data to cache
   * @param expiryMs Optional custom expiry time in milliseconds
   */
  private cacheResponse<T>(cacheKey: string, data: T, expiryMs?: number): void {
    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
      expiryMs: expiryMs ?? this.defaultCacheExpiryMs,
    });
  }

  /**
   * Make a GET request to a Slack API endpoint with caching and rate limiting
   *
   * This method includes several performance optimizations:
   * 1. Response caching to reduce API calls for identical requests
   * 2. Rate limiting protection to prevent hitting Slack API limits
   * 3. Automatic retry for rate-limited requests
   *
   * @param endpoint The API endpoint to call (without the base URL)
   * @param params The query parameters to include in the request
   * @param options Optional request options
   * @param options.skipCache Set to true to bypass the cache and force a fresh request
   * @param options.cacheExpiryMs Custom cache expiration time in milliseconds
   * @returns The response from the API
   * @throws {SlackError} If the request fails or would exceed rate limits
   */
  async get<T = unknown>(
    endpoint: string,
    params: SlackApiParams = {},
    options: { skipCache?: boolean; cacheExpiryMs?: number } = {},
  ): Promise<SlackApiResponse<T>> {
    const url = `${this.baseUrl}/${endpoint}`;
    const headers = this.getBaseHeaders();

    // Remove undefined and null values from params and handle array values
    const cleanParams: Record<
      string,
      string | number | boolean | string[] | number[]
    > = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        // Handle array values properly
        cleanParams[key] = value;
      }
    }

    // Check cache first (unless skipCache is true)
    if (!options.skipCache) {
      const cacheKey = this.getCacheKey(endpoint, cleanParams);
      const cachedResponse =
        this.getCachedResponse<SlackApiResponse<T>>(cacheKey);

      if (cachedResponse) {
        // Return the cached response
        return cachedResponse;
      }
    }

    // Check rate limits before making the request
    if (!this.checkRateLimit(endpoint)) {
      throw new SlackError(
        `Rate limit exceeded for Slack API endpoint: ${endpoint}`,
        endpoint,
        new Error('Too many requests in a short period'),
        429, // HTTP 429 Too Many Requests
        { ok: false, error: 'rate_limited' },
      );
    }

    try {
      // Build query string with token
      const searchParams = new URLSearchParams();
      searchParams.append('token', this.token); // Token goes in query params
      for (const [key, value] of Object.entries(cleanParams)) {
        if (Array.isArray(value)) {
          for (const v of value) {
            searchParams.append(key, String(v));
          }
        } else {
          searchParams.append(key, String(value));
        }
      }
      const fetchUrl = `${url}?${searchParams.toString()}`;

      // Update rate limit tracking
      this.updateRateLimit(endpoint);

      // Use native fetch (Node.js 18+) which allows Cookie headers
      const res = await fetch(fetchUrl, {
        method: 'GET',
        headers,
      });
      const json = (await res.json()) as SlackApiResponse<T>;

      if (!json.ok) {
        throw new SlackError(
          `Slack API error: ${json.error || 'Unknown error'}`,
          endpoint,
          new Error(json.error_description || json.error || 'Unknown error'),
          res.status,
          json,
        );
      }

      // Cache successful responses
      if (!options.skipCache) {
        const cacheKey = this.getCacheKey(endpoint, cleanParams);
        this.cacheResponse(cacheKey, json, options.cacheExpiryMs);
      }

      return json;
    } catch (error: unknown) {
      // Re-throw SlackErrors directly to preserve statusCode and responseData
      if (error instanceof SlackError) {
        throw error;
      }
      throw new SlackError(
        `Error in Slack API GET to ${endpoint}: ${error instanceof Error ? error.message : String(error)}`,
        endpoint,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}
