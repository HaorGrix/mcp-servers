import { XMLParser } from "fast-xml-parser";

const PRODUCTION_ENDPOINT = "https://api.namecheap.com/xml.response";
const SANDBOX_ENDPOINT = "https://api.sandbox.namecheap.com/xml.response";

export class MissingCredentialsError extends Error {
  constructor(missing: string[]) {
    super(
      `Namecheap credentials are not configured. Missing: ${missing.join(", ")}. ` +
        `Set them in the environment — see .env.example. The API key is created at ` +
        `https://ap.www.namecheap.com/settings/tools/apiaccess/ and the calling IP ` +
        `must be whitelisted there or every request is rejected.`,
    );
    this.name = "MissingCredentialsError";
  }
}

export class WritesDisabledError extends Error {
  constructor(tool: string) {
    super(
      `${tool} modifies your Namecheap account and was NOT performed. ` +
        `Writes are disabled. Set NAMECHEAP_ALLOW_WRITES=true to enable them. ` +
        `This server is read-only by default so an accidental call cannot change DNS.`,
    );
    this.name = "WritesDisabledError";
  }
}

export class NamecheapError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "NamecheapError";
    this.code = code;
  }
}

/** Namecheap returns XML only. Attributes are flattened onto the node for readability. */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  trimValues: true,
});

type XmlNode = Record<string, unknown>;

/** Namecheap collapses single-element lists into an object; callers always want an array. */
export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export class NamecheapClient {
  private readonly apiUser: string;
  private readonly apiKey: string;
  private readonly userName: string;
  private readonly clientIp: string;
  private readonly endpoint: string;
  readonly writesEnabled: boolean;
  readonly sandbox: boolean;

  constructor() {
    this.apiUser = process.env.NAMECHEAP_API_USER ?? "";
    this.apiKey = process.env.NAMECHEAP_API_KEY ?? "";
    this.userName = process.env.NAMECHEAP_USERNAME || this.apiUser;
    this.clientIp = process.env.NAMECHEAP_CLIENT_IP ?? "";
    this.sandbox = (process.env.NAMECHEAP_ENV ?? "").toLowerCase() === "sandbox";
    this.endpoint = this.sandbox ? SANDBOX_ENDPOINT : PRODUCTION_ENDPOINT;
    this.writesEnabled = (process.env.NAMECHEAP_ALLOW_WRITES ?? "").toLowerCase() === "true";
  }

  private assertCredentials(): void {
    const missing: string[] = [];
    if (!this.apiUser) missing.push("NAMECHEAP_API_USER");
    if (!this.apiKey) missing.push("NAMECHEAP_API_KEY");
    if (!this.clientIp) missing.push("NAMECHEAP_CLIENT_IP");
    if (missing.length > 0) throw new MissingCredentialsError(missing);
  }

  /** Throws unless writes have been explicitly enabled for this process. */
  assertWritable(tool: string): void {
    if (!this.writesEnabled) throw new WritesDisabledError(tool);
  }

  /**
   * Issues a Namecheap command. Everything is POSTed as form data — `setHosts`
   * sends five parameters per record and would otherwise blow the URL length
   * limit on domains with many records.
   */
  async call(command: string, params: Record<string, string> = {}): Promise<XmlNode> {
    this.assertCredentials();

    const body = new URLSearchParams({
      ApiUser: this.apiUser,
      ApiKey: this.apiKey,
      UserName: this.userName,
      ClientIp: this.clientIp,
      Command: command,
      ...params,
    });

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (err) {
      throw new NamecheapError(
        "NETWORK",
        `Could not reach the Namecheap API: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const text = await response.text();

    if (!response.ok) {
      throw new NamecheapError("HTTP_" + response.status, this.redact(text).slice(0, 400));
    }

    let parsed: XmlNode;
    try {
      parsed = parser.parse(text) as XmlNode;
    } catch {
      throw new NamecheapError("PARSE", `Namecheap returned unparseable XML: ${this.redact(text).slice(0, 300)}`);
    }

    const envelope = parsed["ApiResponse"] as XmlNode | undefined;
    if (!envelope) {
      throw new NamecheapError("PARSE", `Unexpected Namecheap response shape: ${this.redact(text).slice(0, 300)}`);
    }

    if (envelope["Status"] === "ERROR") {
      const errors = (envelope["Errors"] as XmlNode | undefined)?.["Error"];
      const list = asArray(errors as XmlNode | XmlNode[] | undefined);
      const detail = list
        .map((e) => {
          const number = typeof e === "object" && e !== null ? String(e["Number"] ?? "") : "";
          const message = typeof e === "object" && e !== null ? String(e["#text"] ?? "") : String(e);
          return number ? `${number}: ${message}` : message;
        })
        .join("; ");
      throw new NamecheapError("API", detail || "Namecheap returned an error with no detail.");
    }

    const result = envelope["CommandResponse"] as XmlNode | undefined;
    return result ?? envelope;
  }

  /** Credentials appear in the request body; never echo them back in an error. */
  private redact(text: string): string {
    let out = text;
    if (this.apiKey) out = out.split(this.apiKey).join("[redacted]");
    if (this.apiUser) out = out.split(this.apiUser).join("[api-user]");
    return out;
  }
}

/** Namecheap addresses domains as separate second-level and top-level parts. */
export function splitDomain(domain: string): { sld: string; tld: string } {
  const clean = domain.trim().toLowerCase().replace(/\.$/, "");
  const firstDot = clean.indexOf(".");
  if (firstDot <= 0 || firstDot === clean.length - 1) {
    throw new NamecheapError("INPUT", `"${domain}" is not a valid domain name.`);
  }
  return { sld: clean.slice(0, firstDot), tld: clean.slice(firstDot + 1) };
}
