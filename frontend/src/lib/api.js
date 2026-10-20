import axios from "axios";

export const BACKEND = process.env.REACT_APP_BACKEND_URL;
export const api = axios.create({ baseURL: `${BACKEND}/api`, withCredentials: true });

let refreshing = null;
api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const cfg = error.config || {};
    const url = cfg.url || "";
    if (error.response?.status === 401 && !cfg._retry && !url.includes("/auth/")) {
      cfg._retry = true;
      try {
        refreshing = refreshing || api.post("/auth/refresh");
        await refreshing;
        refreshing = null;
        return api(cfg);
      } catch (e) {
        refreshing = null;
      }
    }
    return Promise.reject(error);
  }
);

export function errMsg(e, fallback = "Algo deu errado. Tente novamente.") {
  const d = e?.response?.data?.detail;
  if (d == null) return e?.message ? fallback : fallback;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => (x && typeof x.msg === "string" ? x.msg : JSON.stringify(x))).join(" ");
  if (typeof d.msg === "string") return d.msg;
  return String(d);
}

export const mediaUrl = (u) => (u ? `${BACKEND}${u}` : null);
export const fileUrl = (id) => (id ? `${BACKEND}/api/media/${id}` : null);

export async function downloadFile(path, filename) {
  const r = await api.get(path, { responseType: "blob" });
  const url = URL.createObjectURL(r.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
