import { useState, useEffect } from 'react';

export interface SessionData {
  shop?: string;
  token?: string;
  isAuthenticated: boolean;
  isLoading: boolean;
  error?: string;
}

export function useSession(): SessionData {
  const [sessionData, setSessionData] = useState<SessionData>({
    isAuthenticated: false,
    isLoading: true,
  });

  useEffect(() => {
    const initializeSession = async () => {
      try {
        // Extract shop from URL params
        const urlParams = new URLSearchParams(window.location.search);
        const shop = urlParams.get('shop');
        const host = urlParams.get('host');

        // For now, consider authenticated if we have shop parameter
        const isAuthenticated = Boolean(shop);

        setSessionData({
          shop: shop || undefined,
          token: host || undefined, // Use host as temporary token indicator
          isAuthenticated,
          isLoading: false,
        });
      } catch (error) {
        console.error('Session initialization failed:', error);
        setSessionData({
          isAuthenticated: false,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    };

    initializeSession();
  }, []);

  return sessionData;
} 