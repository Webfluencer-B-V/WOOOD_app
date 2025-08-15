// Proxy component provider for Shopify App Bridge functionality

import { useNavigate } from "react-router";

export interface ProxyProviderProps {
	children: React.ReactNode;
	appUrl?: string;
}

export function Provider({ children, appUrl }: ProxyProviderProps) {
	const navigate = useNavigate();

	// Simple provider wrapper for proxy routes
	// This component provides context for proxy-specific functionality
	return (
		<div data-proxy-provider data-app-url={appUrl}>
			{children}
		</div>
	);
}

Provider.displayName = "ProxyProvider";

// Form component for proxy forms
export interface FormProps {
	children: React.ReactNode;
	method?: string;
	action?: string;
}

export function Form({ children, method = "POST", action }: FormProps) {
	return (
		<form method={method} action={action}>
			{children}
		</form>
	);
}

Form.displayName = "ProxyForm";
