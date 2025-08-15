import {
	Banner,
	BlockStack,
	Button,
	Text,
} from "@shopify/ui-extensions-react/checkout";
import React, { Component, type ReactNode } from "react";

interface ErrorBoundaryState {
	hasError: boolean;
	error?: Error;
	errorInfo?: React.ErrorInfo;
	errorId: string;
}

interface ErrorBoundaryProps {
	children: ReactNode;
	fallback?: ReactNode;
	onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

export class ErrorBoundary extends Component<
	ErrorBoundaryProps,
	ErrorBoundaryState
> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = {
			hasError: false,
			errorId: this.generateErrorId(),
		};
	}

	private generateErrorId(): string {
		return Math.random().toString(36).substring(2) + Date.now().toString(36);
	}

	static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
		return {
			hasError: true,
			error,
			errorId:
				Math.random().toString(36).substring(2) + Date.now().toString(36),
		};
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		this.setState({
			error,
			errorInfo,
		});

		// Log error details
		this.logError(error, errorInfo);

		// Call optional error callback
		if (this.props.onError) {
			this.props.onError(error, errorInfo);
		}
	}

	private logError(error: Error, errorInfo: React.ErrorInfo) {
		const errorData = {
			errorId: this.state.errorId,
			name: error.name,
			message: error.message,
			stack: error.stack,
			componentStack: errorInfo.componentStack,
			timestamp: new Date().toISOString(),
			userAgent:
				typeof navigator !== "undefined"
					? navigator.userAgent
					: "checkout-extension",
			url:
				typeof window !== "undefined"
					? window.location?.href
					: "checkout-extension-context",
		};

		console.error("Extension Error Boundary caught an error:", errorData);
	}

	// sendErrorToService intentionally removed to avoid unused private member

	private handleRetry = () => {
		this.setState({
			hasError: false,
			error: undefined,
			errorInfo: undefined,
			errorId: this.generateErrorId(),
		});
	};

	render() {
		if (this.state.hasError) {
			const isCheckoutPreview =
				typeof window !== "undefined" &&
				window.location.href.includes("preview");

			if (!isCheckoutPreview) {
				return <BlockStack spacing="none" />;
			}

			if (this.props.fallback) {
				return this.props.fallback;
			}

			return (
				<BlockStack spacing="base">
					<Banner status="critical">
						<BlockStack spacing="tight">
							<Text size="medium" emphasis="bold">
								Something went wrong
							</Text>
							<Text size="small">
								We encountered an unexpected error while loading the delivery
								date picker. Please try refreshing the page or contact support
								if the problem persists.
							</Text>
							<Text size="small" appearance="subdued">
								Error ID: {this.state.errorId}
							</Text>
						</BlockStack>
					</Banner>

					<Button onPress={this.handleRetry} kind="secondary">
						Try Again
					</Button>

					{this.state.error && (
						<BlockStack spacing="tight">
							<Text size="small" emphasis="bold">
								Debug Information:
							</Text>
							<Text size="small" appearance="subdued">
								{this.state.error.message}
							</Text>
							{this.state.error.stack && (
								<Text size="small" appearance="subdued">
									{this.state.error.stack.split("\n").slice(0, 3).join("\n")}
								</Text>
							)}
						</BlockStack>
					)}
				</BlockStack>
			);
		}

		return this.props.children;
	}
}

// Hook-based error boundary for functional components
export const useErrorHandler = () => {
	const handleError = React.useCallback(
		(error: Error, errorInfo?: Partial<React.ErrorInfo>) => {
			const errorId =
				Math.random().toString(36).substring(2) + Date.now().toString(36);

			const errorData = {
				errorId,
				name: error.name,
				message: error.message,
				stack: error.stack,
				timestamp: new Date().toISOString(),
				userAgent:
					typeof navigator !== "undefined"
						? navigator.userAgent
						: "checkout-extension",
				url:
					typeof window !== "undefined"
						? window.location?.href
						: "checkout-extension-context",
				...errorInfo,
			};

			console.error("Manual error handling:", errorData);

			return errorId;
		},
		[],
	);

	return { handleError };
};
