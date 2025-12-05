import axios from "axios";

const USER_AGENT =
  "Mozilla/5.0 (compatible; DistrictBot/1.2; +https://districtnews.ai)";
const TIMEOUT = 9000;

export async function httpGet(url: string): Promise<string | null> {
  try {
    const res = await axios.get(url, {
      timeout: TIMEOUT,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "*/*",
      },
      maxBodyLength: 10 * 1024 * 1024,
    });

    return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  } catch (err: any) {
    console.error("HTTP GET FAILED:", url, err.message);
    return null;
  }
}
