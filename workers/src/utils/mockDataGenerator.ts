import { DeliveryDate } from '../types/common';

/**
 * Generate mock delivery dates for testing and fallback purposes
 * Migrated from Express backend to Cloudflare Workers
 * Optimized for V8 isolate environment
 */
export function generateMockDeliveryDates(): DeliveryDate[] {
  const dates: DeliveryDate[] = [];
  const today = new Date();
  
  // Generate mock dates for the next 14 weekdays, excluding weekends
  // Use a maximum of 20 iterations to prevent infinite loops
  for (let i = 1; i <= 20; i++) {
    const futureDate = new Date(today);
    futureDate.setDate(today.getDate() + i);
    
    // Skip weekends (Saturday = 6, Sunday = 0)
    const dayOfWeek = futureDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      continue;
    }

    // Format date as YYYY-MM-DD (ISO format)
    const isoString = futureDate.toISOString();
    const dateString = isoString.split('T')[0] || isoString.substring(0, 10);
    
    // Generate Dutch display name using Intl.DateTimeFormat for V8 compatibility
    const displayName = formatDutchDate(futureDate);

    dates.push({
      date: dateString,
      displayName
    });

    // Stop when we have 14 weekdays
    if (dates.length >= 14) {
      break;
    }
  }

  return dates;
}

/**
 * Format date in Dutch locale for display
 * Uses Intl.DateTimeFormat for consistent V8 isolate compatibility
 * Always returns a valid string
 */
function formatDutchDate(date: Date): string {
  try {
    // Use Intl.DateTimeFormat for reliable locale formatting in V8 isolates
    const formatted = new Intl.DateTimeFormat('nl-NL', {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    }).format(date);
    
    return formatted || fallbackFormatDutchDate(date);
  } catch (error) {
    return fallbackFormatDutchDate(date);
  }
}

/**
 * Fallback formatting for Dutch dates
 * Ensures we always return a valid string
 */
function fallbackFormatDutchDate(date: Date): string {
  const weekdays = [
    'zondag', 'maandag', 'dinsdag', 'woensdag', 
    'donderdag', 'vrijdag', 'zaterdag'
  ];
  const months = [
    'jan', 'feb', 'mrt', 'apr', 'mei', 'jun',
    'jul', 'aug', 'sep', 'okt', 'nov', 'dec'
  ];

  const dayOfWeek = date.getDay();
  const monthIndex = date.getMonth();
  
  const weekday = weekdays[dayOfWeek] || 'onbekend';
  const day = date.getDate();
  const month = months[monthIndex] || 'onbekend';

  return `${weekday} ${day} ${month}`;
}

/**
 * Generate mock delivery dates with custom parameters
 * Extended version for more flexible testing scenarios
 */
export function generateCustomMockDeliveryDates(
  startDate?: Date,
  count?: number,
  includeWeekends?: boolean
): DeliveryDate[] {
  const dates: DeliveryDate[] = [];
  const baseDate = startDate || new Date();
  const targetCount = Math.min(count || 14, 30); // Cap at 30 dates for performance
  const maxIterations = includeWeekends ? targetCount + 5 : targetCount * 2;
  
  for (let i = 1; i <= maxIterations && dates.length < targetCount; i++) {
    const futureDate = new Date(baseDate);
    futureDate.setDate(baseDate.getDate() + i);
    
    // Skip weekends unless explicitly included
    if (!includeWeekends) {
      const dayOfWeek = futureDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        continue;
      }
    }

    const isoString = futureDate.toISOString();
    const dateString = isoString.split('T')[0] || isoString.substring(0, 10);
    const displayName = formatDutchDate(futureDate);

    dates.push({
      date: dateString,
      displayName
    });
  }

  return dates;
}

/**
 * Validate delivery date format
 * Useful for testing and data validation
 */
export function isValidDeliveryDate(date: DeliveryDate): boolean {
  if (!date || typeof date !== 'object') {
    return false;
  }

  // Check date field
  if (!date.date || typeof date.date !== 'string') {
    return false;
  }

  // Validate YYYY-MM-DD format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date.date)) {
    return false;
  }

  // Check if date is actually valid
  const parsedDate = new Date(date.date);
  if (isNaN(parsedDate.getTime())) {
    return false;
  }

  // Check displayName field
  if (!date.displayName || typeof date.displayName !== 'string') {
    return false;
  }

  return true;
}

/**
 * Filter delivery dates to business days only
 * Utility function for processing API responses
 */
export function filterBusinessDays(dates: DeliveryDate[]): DeliveryDate[] {
  return dates.filter(date => {
    const parsedDate = new Date(date.date);
    const dayOfWeek = parsedDate.getDay();
    return dayOfWeek !== 0 && dayOfWeek !== 6; // Exclude Sunday (0) and Saturday (6)
  });
}

/**
 * Sort delivery dates chronologically
 * Utility function for processing API responses
 */
export function sortDeliveryDates(dates: DeliveryDate[]): DeliveryDate[] {
  return [...dates].sort((a, b) => {
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    return dateA.getTime() - dateB.getTime();
  });
} 