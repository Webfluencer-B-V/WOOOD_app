/**
 * Production Monitoring and Alerting Service
 * Provides real-time monitoring, error tracking, and alerting for WOOOD system
 */

import { Env } from '../types/env';
import { WorkersLogger } from '../utils/logger';

export interface MonitoringMetrics {
  timestamp: string;
  endpoint: string;
  method: string;
  statusCode: number;
  responseTime: number;
  errorMessage?: string;
  shopDomain?: string;
  requestId: string;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'down';
  uptime: number;
  responseTime: number;
  errorRate: number;
  lastError?: string | undefined;
  activeConnections: number;
  memoryUsage: number;
}

export interface AlertThresholds {
  maxResponseTime: number;
  maxErrorRate: number;
  minUptime: number;
}

export class MonitoringService {
  private env: Env;
  private logger: WorkersLogger;
  private readonly METRICS_RETENTION_HOURS = 24;
  private readonly ALERT_COOLDOWN_MINUTES = 15;

  constructor(env: Env, logger: WorkersLogger) {
    this.env = env;
    this.logger = logger;
  }

  /**
   * Record API request metrics
   */
  async recordMetrics(metrics: MonitoringMetrics): Promise<void> {
    try {
      const key = `metrics:${Date.now()}:${metrics.requestId}`;
      const expirationTtl = this.METRICS_RETENTION_HOURS * 60 * 60; // 24 hours

      await this.env.DELIVERY_CACHE?.put(key, JSON.stringify(metrics), {
        expirationTtl
      });

      // Update rolling counters
      await this.updateRollingCounters(metrics);

      this.logger.info('Metrics recorded', {
        endpoint: metrics.endpoint,
        responseTime: metrics.responseTime,
        statusCode: metrics.statusCode
      });

    } catch (error) {
      this.logger.error('Failed to record metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: metrics.requestId
      });
    }
  }

  /**
   * Get current system health status
   */
  async getSystemHealth(): Promise<SystemHealth> {
    try {
      const now = Date.now();
      const oneHourAgo = now - (60 * 60 * 1000);

      // Get recent metrics
      const recentMetrics = await this.getRecentMetrics(oneHourAgo, now);

      // Calculate health metrics
      const totalRequests = recentMetrics.length;
      const errorRequests = recentMetrics.filter(m => m.statusCode >= 400).length;
      const avgResponseTime = totalRequests > 0
        ? recentMetrics.reduce((sum, m) => sum + m.responseTime, 0) / totalRequests
        : 0;

      const errorRate = totalRequests > 0 ? (errorRequests / totalRequests) * 100 : 0;
      const uptime = await this.calculateUptime();

      // Determine health status
      let status: SystemHealth['status'] = 'healthy';
      if (errorRate > 5 || avgResponseTime > 2000) {
        status = 'degraded';
      }
      if (errorRate > 20 || avgResponseTime > 5000) {
        status = 'down';
      }

      const health: SystemHealth = {
        status,
        uptime,
        responseTime: Math.round(avgResponseTime),
        errorRate: Math.round(errorRate * 100) / 100,
        lastError: await this.getLastError(),
        activeConnections: totalRequests,
        memoryUsage: 0 // Cloudflare Workers doesn't expose memory usage
      };

      return health;

    } catch (error) {
      this.logger.error('Failed to get system health', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        status: 'down',
        uptime: 0,
        responseTime: 0,
        errorRate: 100,
        lastError: 'Failed to retrieve health metrics',
        activeConnections: 0,
        memoryUsage: 0
      };
    }
  }

  /**
   * Check if alerts should be triggered
   */
  async checkAlertThresholds(health: SystemHealth): Promise<void> {
    const thresholds: AlertThresholds = {
      maxResponseTime: 3000, // 3 seconds
      maxErrorRate: 10, // 10%
      minUptime: 99.5 // 99.5%
    };

    const alerts: string[] = [];

    if (health.responseTime > thresholds.maxResponseTime) {
      alerts.push(`High response time: ${health.responseTime}ms (threshold: ${thresholds.maxResponseTime}ms)`);
    }

    if (health.errorRate > thresholds.maxErrorRate) {
      alerts.push(`High error rate: ${health.errorRate}% (threshold: ${thresholds.maxErrorRate}%)`);
    }

    if (health.uptime < thresholds.minUptime) {
      alerts.push(`Low uptime: ${health.uptime}% (threshold: ${thresholds.minUptime}%)`);
    }

    if (alerts.length > 0) {
      await this.triggerAlerts(alerts, health);
    }
  }

  /**
   * Get performance analytics for dashboard
   */
  async getAnalytics(hours: number = 24): Promise<{
    totalRequests: number;
    successRate: number;
    avgResponseTime: number;
    topEndpoints: Array<{ endpoint: string; count: number; avgResponseTime: number }>;
    errorsByHour: Array<{ hour: string; errors: number }>;
  }> {
    try {
      const now = Date.now();
      const startTime = now - (hours * 60 * 60 * 1000);

      const metrics = await this.getRecentMetrics(startTime, now);

      const totalRequests = metrics.length;
      const successfulRequests = metrics.filter(m => m.statusCode < 400).length;
      const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 100;
      const avgResponseTime = totalRequests > 0
        ? metrics.reduce((sum, m) => sum + m.responseTime, 0) / totalRequests
        : 0;

      // Top endpoints by request count
      const endpointStats = new Map<string, { count: number; totalTime: number }>();
      metrics.forEach(m => {
        const key = `${m.method} ${m.endpoint}`;
        const existing = endpointStats.get(key) || { count: 0, totalTime: 0 };
        endpointStats.set(key, {
          count: existing.count + 1,
          totalTime: existing.totalTime + m.responseTime
        });
      });

      const topEndpoints = Array.from(endpointStats.entries())
        .map(([endpoint, stats]) => ({
          endpoint,
          count: stats.count,
          avgResponseTime: Math.round(stats.totalTime / stats.count)
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Errors by hour
      const errorsByHour = this.groupErrorsByHour(metrics, hours);

      return {
        totalRequests,
        successRate: Math.round(successRate * 100) / 100,
        avgResponseTime: Math.round(avgResponseTime),
        topEndpoints,
        errorsByHour
      };

    } catch (error) {
      this.logger.error('Failed to get analytics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        totalRequests: 0,
        successRate: 0,
        avgResponseTime: 0,
        topEndpoints: [],
        errorsByHour: []
      };
    }
  }

  /**
   * Private helper methods
   */
  private async updateRollingCounters(metrics: MonitoringMetrics): Promise<void> {
    const hourKey = `counter:hour:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
    const dayKey = `counter:day:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;

    try {
      // Update hourly counter
      const hourlyCount = await this.env.DELIVERY_CACHE?.get(hourKey);
      const newHourlyCount = (parseInt(hourlyCount || '0') + 1).toString();
      await this.env.DELIVERY_CACHE?.put(hourKey, newHourlyCount, { expirationTtl: 60 * 60 * 25 }); // 25 hours

      // Update daily counter
      const dailyCount = await this.env.DELIVERY_CACHE?.get(dayKey);
      const newDailyCount = (parseInt(dailyCount || '0') + 1).toString();
      await this.env.DELIVERY_CACHE?.put(dayKey, newDailyCount, { expirationTtl: 24 * 60 * 60 * 8 }); // 8 days

    } catch (error) {
      this.logger.error('Failed to update rolling counters', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async getRecentMetrics(startTime: number, endTime: number): Promise<MonitoringMetrics[]> {
    try {
      // Note: This is a simplified implementation
      // In production, you might want to use Cloudflare Analytics or external monitoring
      const listResponse = await this.env.DELIVERY_CACHE?.list({ prefix: 'metrics:' });
      const metrics: MonitoringMetrics[] = [];

      if (listResponse?.keys) {
        for (const key of listResponse.keys.slice(0, 1000)) { // Limit to recent 1000 entries
          const data = await this.env.DELIVERY_CACHE?.get(key.name);
          if (data) {
            const metric = JSON.parse(data) as MonitoringMetrics;
            const metricTime = new Date(metric.timestamp).getTime();
            if (metricTime >= startTime && metricTime <= endTime) {
              metrics.push(metric);
            }
          }
        }
      }

      return metrics.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    } catch (error) {
      this.logger.error('Failed to get recent metrics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  private async calculateUptime(): Promise<number> {
    try {
      const uptimeKey = 'system:uptime:start';
      const startTime = await this.env.DELIVERY_CACHE?.get(uptimeKey);

      if (!startTime) {
        // First time - record start time
        await this.env.DELIVERY_CACHE?.put(uptimeKey, Date.now().toString());
        return 100;
      }

      const startTimestamp = parseInt(startTime);
      const uptime = ((Date.now() - startTimestamp) / (24 * 60 * 60 * 1000)) * 100;
      return Math.min(uptime, 100);

    } catch (error) {
      return 0;
    }
  }

  private async getLastError(): Promise<string | undefined> {
    try {
      const lastError = await this.env.DELIVERY_CACHE?.get('system:last_error');
      return lastError || undefined;
    } catch (error) {
      return undefined;
    }
  }

  private groupErrorsByHour(metrics: MonitoringMetrics[], hours: number): Array<{ hour: string; errors: number }> {
    const errorsByHour = new Map<string, number>();
    const now = new Date();

    // Initialize all hours with 0 errors
    for (let i = 0; i < hours; i++) {
      const hour = new Date(now.getTime() - (i * 60 * 60 * 1000));
      const hourKey = hour.getHours().toString().padStart(2, '0') + ':00';
      errorsByHour.set(hourKey, 0);
    }

    // Count actual errors
    metrics
      .filter(m => m.statusCode >= 400)
      .forEach(m => {
        const hour = new Date(m.timestamp);
        const hourKey = hour.getHours().toString().padStart(2, '0') + ':00';
        errorsByHour.set(hourKey, (errorsByHour.get(hourKey) || 0) + 1);
      });

    return Array.from(errorsByHour.entries())
      .map(([hour, errors]) => ({ hour, errors }))
      .sort((a, b) => a.hour.localeCompare(b.hour));
  }

  private async triggerAlerts(alerts: string[], health: SystemHealth): Promise<void> {
    try {
      // Check alert cooldown
      const lastAlertKey = 'system:last_alert';
      const lastAlert = await this.env.DELIVERY_CACHE?.get(lastAlertKey);
      const cooldownMs = this.ALERT_COOLDOWN_MINUTES * 60 * 1000;

      if (lastAlert && (Date.now() - parseInt(lastAlert)) < cooldownMs) {
        return; // Still in cooldown period
      }

      // Record this alert
      await this.env.DELIVERY_CACHE?.put(lastAlertKey, Date.now().toString());

      this.logger.error('System alerts triggered', {
        alerts,
        systemHealth: health,
        timestamp: new Date().toISOString()
      });

      // In production, you could integrate with:
      // - Slack/Discord webhooks
      // - Email notifications
      // - PagerDuty
      // - Cloudflare Workers Analytics

    } catch (error) {
      this.logger.error('Failed to trigger alerts', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

export function createMonitoringService(env: Env, logger: WorkersLogger): MonitoringService {
  return new MonitoringService(env, logger);
}