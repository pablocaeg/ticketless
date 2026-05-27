import type { ToolDefinition } from "../../types.js";
import type { Tool } from "../../core/interfaces.js";

export class StripeLookupTool implements Tool {
  readonly definition: ToolDefinition = {
    name: "stripe_lookup",
    description: "Look up Stripe billing data for a customer: subscriptions, invoices, payment methods, and charges. Use this to investigate billing or payment issues.",
    parameters: {
      action: {
        type: "string",
        description: "Action: customer, subscriptions, invoices, charges, or payment_methods",
        required: true,
      },
      email: {
        type: "string",
        description: "Customer email to search by",
      },
      customerId: {
        type: "string",
        description: "Stripe customer ID (cus_...)",
      },
      limit: {
        type: "number",
        description: "Max results to return (default: 10)",
      },
    },
  };

  constructor(private apiKey: string) {}

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const action = String(args.action ?? "");
    const email = args.email ? String(args.email) : null;
    const customerId = args.customerId ? String(args.customerId) : null;
    const limit = Number(args.limit ?? 10);

    let stripeCustomerId = customerId;

    if (!stripeCustomerId && email) {
      const searchResult = await this.stripeRequest(
        `/v1/customers/search?query=email:'${encodeURIComponent(email)}'`
      ) as { data?: Array<{ id: string }> };
      const customers = searchResult.data ?? [];
      if (customers.length === 0) return { found: false, email };
      stripeCustomerId = customers[0].id;
    }

    if (!stripeCustomerId) {
      throw new Error("Either email or customerId is required");
    }

    switch (action) {
      case "customer":
        return this.stripeRequest(`/v1/customers/${stripeCustomerId}`);

      case "subscriptions":
        return this.stripeRequest(
          `/v1/subscriptions?customer=${stripeCustomerId}&limit=${limit}`
        );

      case "invoices":
        return this.stripeRequest(
          `/v1/invoices?customer=${stripeCustomerId}&limit=${limit}`
        );

      case "charges":
        return this.stripeRequest(
          `/v1/charges?customer=${stripeCustomerId}&limit=${limit}`
        );

      case "payment_methods":
        return this.stripeRequest(
          `/v1/payment_methods?customer=${stripeCustomerId}&type=card&limit=${limit}`
        );

      default:
        throw new Error(
          `Unknown action: ${action}. Use: customer, subscriptions, invoices, charges, or payment_methods`
        );
    }
  }

  private async stripeRequest(path: string): Promise<unknown> {
    const response = await fetch(`https://api.stripe.com${path}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Stripe API error ${response.status}: ${text}`);
    }

    return response.json();
  }
}
