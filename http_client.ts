import { getConfig } from "./config";

export interface FetchHTMLResult {
    html: string;
    redirected: boolean;
    url: string;
    status: number;
    location: string | null;
}

export interface FetchHTMLOptions {
    redirect?: RequestRedirect;
}

export async function fetchHTML(url: string): Promise<string> {
    const result = await fetchHTMLWithMetadata(url);
    return result.html;
}

export async function fetchHTMLWithMetadata(url: string, options: FetchHTMLOptions = {}): Promise<FetchHTMLResult> {
    const maxRetries = 3;
    const retryDelay = 1000; // 1秒
    const config = getConfig();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        try {
            const response = await fetch(url, {
                headers: {
                    "user-agent": config.userAgent,
                    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                    "accept-encoding": "gzip, deflate, br, zstd",
                    "accept-language": "ja,en-US;q=0.9,en;q=0.8",
                    "cache-control": "no-cache",
                    pragma: "no-cache",
                    "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": '"macOS"',
                    "sec-fetch-dest": "document",
                    "sec-fetch-mode": "navigate",
                    "sec-fetch-site": "none",
                    "sec-fetch-user": "?1",
                    "upgrade-insecure-requests": "1",
                },
                referrerPolicy: "strict-origin-when-cross-origin",
                redirect: options.redirect ?? "follow",
                signal: controller.signal,
            });

            const redirected =
                response.redirected || (response.status >= 300 && response.status < 400) || response.url !== url;

            if (redirected && options.redirect === "manual") {
                return {
                    html: "",
                    redirected: true,
                    url: response.url,
                    status: response.status,
                    location: response.headers.get("location"),
                };
            }

            if (!response.ok) {
                throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
            }

            return {
                html: await response.text(),
                redirected,
                url: response.url,
                status: response.status,
                location: response.headers.get("location"),
            };
        } catch (error) {
            clearTimeout(timeout);

            if (attempt === maxRetries) {
                throw error;
            }

            console.warn(`Attempt ${attempt} failed, retrying in ${retryDelay}ms...`, error);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        } finally {
            clearTimeout(timeout);
        }
    }

    throw new Error("All retry attempts failed");
}
