import type { OmniaPricingStatus } from "app/types/app";

export interface EmailConfig {
	provider: "cloudflare";
	from: string;
	recipients: string[];
	subjectPrefix?: string;
}

export interface EmailPayload {
	personalizations: Array<{
		to: Array<{ email: string }>;
	}>;
	from: { email: string };
	subject: string;
	content: Array<{
		type: "text/html";
		value: string;
	}>;
}

export async function sendOmniaReportEmail(
	status: OmniaPricingStatus,
	config: EmailConfig,
): Promise<{ success: boolean; error?: string }> {
	if (config.provider !== "cloudflare") {
		throw new Error(`Unsupported email provider: ${config.provider}`);
	}

	if (!config.recipients.length) {
		throw new Error("No email recipients configured");
	}

	try {
		const subject = `${config.subjectPrefix || ""}Omnia Pricing Sync — ${status.shop} — ${new Date(status.timestamp).toLocaleString()}`;
		const htmlContent = generateOmniaReportHTML(status);

		const payload: EmailPayload = {
			personalizations: [
				{
					to: config.recipients.map((email) => ({ email })),
				},
			],
			from: { email: config.from },
			subject,
			content: [
				{
					type: "text/html",
					value: htmlContent,
				},
			],
		};

		const response = await fetch("https://api.mailchannels.net/tx/v1/send", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			let errorDetail = "";
			try {
				const text = await response.text();
				errorDetail = `: ${text.slice(0, 256)}`;
			} catch {}

			throw new Error(
				`Email send failed: ${response.status} ${response.statusText}${errorDetail}`,
			);
		}

		console.log(
			`📧 Omnia report email sent to ${config.recipients.length} recipients`,
		);
		return { success: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error("❌ Failed to send Omnia report email:", message);
		return { success: false, error: message };
	}
}

function generateOmniaReportHTML(status: OmniaPricingStatus): string {
	const { summary } = status;
	if (!summary) {
		return `
      <html>
        <body>
          <h2>WOOOD Omnia Pricing Sync Report</h2>
          <p><strong>Shop:</strong> ${status.shop}</p>
          <p><strong>Timestamp:</strong> ${new Date(status.timestamp).toLocaleString()}</p>
          <p><strong>Status:</strong> ${status.success ? "✅ Success" : "❌ Failed"}</p>
          ${status.error ? `<p><strong>Error:</strong> ${status.error}</p>` : ""}
          <p>No summary data available.</p>
        </body>
      </html>
    `;
	}

	const updatedSamplesTable = summary.updatedSamples?.length
		? `
      <h3>Recent Price Updates (Sample)</h3>
      <table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%;">
        <thead>
          <tr style="background-color: #f0f0f0;">
            <th>EAN</th>
            <th>Product ID</th>
            <th>Old Price</th>
            <th>New Price</th>
            <th>Change</th>
          </tr>
        </thead>
        <tbody>
          ${summary.updatedSamples
						.slice(0, 50)
						.map(
							(sample) => `
            <tr>
              <td>${sample.ean}</td>
              <td>${sample.productId.split("/").pop()}</td>
              <td>€${sample.oldPrice.toFixed(2)}</td>
              <td>€${sample.newPrice.toFixed(2)}</td>
              <td style="color: ${sample.priceChange > 0 ? "red" : sample.priceChange < 0 ? "green" : "gray"};">
                ${sample.priceChange > 0 ? "+" : ""}€${sample.priceChange.toFixed(2)}
              </td>
            </tr>
          `,
						)
						.join("")}
        </tbody>
      </table>
      ${summary.updatedSamples.length > 50 ? `<p><em>Showing first 50 of ${summary.updatedSamples.length} updates</em></p>` : ""}
    `
		: "";

	const invalidSamplesSection = summary.invalidSamples?.length
		? `
      <h3>Validation Errors (Sample)</h3>
      <table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%;">
        <thead>
          <tr style="background-color: #fff0f0;">
            <th>EAN</th>
            <th>Error Code</th>
            <th>Error Message</th>
            <th>Current Price</th>
            <th>Proposed Price</th>
          </tr>
        </thead>
        <tbody>
          ${summary.invalidSamples
						.slice(0, 20)
						.map(
							(error) => `
            <tr>
              <td>${error.ean}</td>
              <td>${error.errorCode}</td>
              <td>${error.errorMessage}</td>
              <td>€${error.currentPrice.toFixed(2)}</td>
              <td>€${error.newPrice.toFixed(2)}</td>
            </tr>
          `,
						)
						.join("")}
        </tbody>
      </table>
      ${summary.invalidSamples.length > 20 ? `<p><em>Showing first 20 of ${summary.invalidSamples.length} errors</em></p>` : ""}
    `
		: "";

	return `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          table { border-collapse: collapse; width: 100%; margin: 10px 0; }
          th, td { padding: 8px; text-align: left; border: 1px solid #ddd; }
          th { background-color: #f0f0f0; font-weight: bold; }
          .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin: 20px 0; }
          .metric { background-color: #f8f9fa; padding: 10px; border-radius: 5px; }
          .metric-value { font-size: 24px; font-weight: bold; color: #2563eb; }
          .metric-label { font-size: 14px; color: #6b7280; }
        </style>
      </head>
      <body>
        <h2>🏠 WOOOD Omnia Pricing Sync Report</h2>
        
        <div style="background-color: #f0f9ff; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p><strong>Shop:</strong> ${status.shop}</p>
          <p><strong>Timestamp:</strong> ${new Date(status.timestamp).toLocaleString()}</p>
          <p><strong>Status:</strong> ${status.success ? "✅ Success" : "❌ Failed"}</p>
          <p><strong>Trigger:</strong> ${status.cron ? "🕐 Scheduled (4:00 AM UTC)" : "👤 Manual"}</p>
          ${status.error ? `<p><strong>Error:</strong> ${status.error}</p>` : ""}
        </div>

        <h3>📊 Summary Metrics</h3>
        <div class="metrics">
          <div class="metric">
            <div class="metric-value">${summary.successful}</div>
            <div class="metric-label">Prices Updated</div>
          </div>
          <div class="metric">
            <div class="metric-value">${summary.failed}</div>
            <div class="metric-label">Failed Updates</div>
          </div>
          <div class="metric">
            <div class="metric-value">${summary.sourceTotal}</div>
            <div class="metric-label">Feed Products</div>
          </div>
          <div class="metric">
            <div class="metric-value">${summary.totalMatches}</div>
            <div class="metric-label">Product Matches</div>
          </div>
          <div class="metric">
            <div class="metric-value">${summary.validMatches}</div>
            <div class="metric-label">Valid Updates</div>
          </div>
          <div class="metric">
            <div class="metric-value">${summary.invalidMatches}</div>
            <div class="metric-label">Validation Errors</div>
          </div>
        </div>

        <h3>💰 Price Changes</h3>
        <div class="metrics">
          <div class="metric">
            <div class="metric-value" style="color: #dc2626;">${summary.priceIncreases}</div>
            <div class="metric-label">Price Increases</div>
          </div>
          <div class="metric">
            <div class="metric-value" style="color: #059669;">${summary.priceDecreases}</div>
            <div class="metric-label">Price Decreases</div>
          </div>
          <div class="metric">
            <div class="metric-value" style="color: #6b7280;">${summary.priceUnchanged}</div>
            <div class="metric-label">Unchanged</div>
          </div>
        </div>

        <h3>📋 Feed Statistics</h3>
        <div class="metrics">
          <div class="metric">
            <div class="metric-value">${summary.feedStats.totalRows}</div>
            <div class="metric-label">Total Feed Rows</div>
          </div>
          <div class="metric">
            <div class="metric-value">${summary.feedStats.validRows}</div>
            <div class="metric-label">Valid Rows</div>
          </div>
          <div class="metric">
            <div class="metric-value">${summary.feedStats.invalidRows}</div>
            <div class="metric-label">Invalid Rows</div>
          </div>
        </div>

        ${updatedSamplesTable}
        ${invalidSamplesSection}

        <hr style="margin: 30px 0;">
        <p style="font-size: 12px; color: #6b7280;">
          Generated by WOOOD Shopify Integration • 
          ${new Date().toISOString()}
        </p>
      </body>
    </html>
  `;
}

export function parseEmailRecipients(recipients: string): string[] {
	if (!recipients) return [];
	return recipients
		.split(",")
		.map((email) => email.trim())
		.filter((email) => email.length > 0);
}
