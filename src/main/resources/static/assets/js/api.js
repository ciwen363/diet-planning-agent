(function () {
    "use strict";

    const API_BASE = "/api/v1/diet";
    const USER_ID_KEY = "diet.userId";
    const DEFAULT_TIMEOUT_MS = 30000;

    class ApiError extends Error {
        constructor(options) {
            const detail = options || {};
            super(detail.message || "请求失败");
            this.name = "ApiError";
            this.status = detail.status || 0;
            this.backendMessage = detail.backendMessage || "";
            this.raw = detail.raw || "";
            this.timeout = Boolean(detail.timeout);
            this.aborted = Boolean(detail.aborted);
            this.context = detail.context || null;
        }
    }

    function getUserId() {
        return localStorage.getItem(USER_ID_KEY) || "1";
    }

    function setUserId(userId) {
        const normalized = String(userId || "1").trim() || "1";
        localStorage.setItem(USER_ID_KEY, normalized);
        return normalized;
    }

    function buildSignal(signal, timeoutMs) {
        const controller = new AbortController();
        let timedOut = false;
        let timer = null;

        const abortFromCaller = () => controller.abort(signal.reason);
        if (signal) {
            if (signal.aborted) {
                abortFromCaller();
            } else {
                signal.addEventListener("abort", abortFromCaller, { once: true });
            }
        }

        if (timeoutMs > 0) {
            timer = window.setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, timeoutMs);
        }

        return {
            signal: controller.signal,
            timedOut: () => timedOut,
            cleanup: () => {
                if (timer) {
                    window.clearTimeout(timer);
                }
                if (signal) {
                    signal.removeEventListener("abort", abortFromCaller);
                }
            }
        };
    }

    async function request(path, options) {
        const config = options || {};
        const timeoutMs = config.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : Number(config.timeoutMs);
        const signalBundle = buildSignal(config.signal, timeoutMs);
        const headers = new Headers(config.headers || {});
        headers.set("X-User-Id", getUserId());

        if (config.body !== undefined && !(config.body instanceof FormData)) {
            headers.set("Content-Type", "application/json");
        }

        try {
            const response = await fetch(`${API_BASE}${path}`, {
                ...config,
                headers,
                signal: signalBundle.signal,
                body: config.body === undefined || config.body instanceof FormData
                    ? config.body
                    : JSON.stringify(config.body)
            });

            if (!response.ok) {
                const detail = await readError(response);
                throw new ApiError({
                    status: response.status,
                    message: detail.message || `请求失败：${response.status}`,
                    backendMessage: detail.message,
                    raw: detail.raw,
                    context: config.context || null
                });
            }

            if (response.status === 204) {
                return null;
            }

            const text = await response.text();
            if (!text) {
                return null;
            }

            try {
                return JSON.parse(text);
            } catch (error) {
                return text;
            }
        } catch (error) {
            if (error instanceof ApiError) {
                throw error;
            }

            if (error && error.name === "AbortError") {
                throw new ApiError({
                    message: signalBundle.timedOut() ? "请求超时" : "请求已取消",
                    timeout: signalBundle.timedOut(),
                    aborted: !signalBundle.timedOut(),
                    context: config.context || null
                });
            }

            throw new ApiError({
                message: "网络不可达，请检查后端服务或网络连接",
                raw: error && error.message ? error.message : String(error),
                context: config.context || null
            });
        } finally {
            signalBundle.cleanup();
        }
    }

    async function readError(response) {
        const text = await response.text();
        if (!text) {
            return { message: "", raw: "" };
        }

        try {
            const payload = JSON.parse(text);
            return {
                message: payload.message || payload.error || text,
                raw: text
            };
        } catch (error) {
            return { message: text, raw: text };
        }
    }

    function toQuery(params) {
        const search = new URLSearchParams();
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== "") {
                search.set(key, value);
            }
        });
        const query = search.toString();
        return query ? `?${query}` : "";
    }

    window.DietApi = {
        ApiError,
        getUserId,
        setUserId,
        createSession: (options) => request("/sessions", { method: "POST", ...(options || {}) }),
        chat: (payload, options) => request("/chat", { method: "POST", body: payload, context: payload, ...(options || {}) }),
        listPersonalMeals: (options) => request("/meals/personal", options),
        createPersonalMeal: (payload, options) => request("/meals/personal", { method: "POST", body: payload, ...(options || {}) }),
        updatePersonalMeal: (mealId, payload, options) => request(`/meals/personal/${encodeURIComponent(mealId)}`, { method: "PUT", body: payload, ...(options || {}) }),
        deletePersonalMeal: (mealId, options) => request(`/meals/personal/${encodeURIComponent(mealId)}`, { method: "DELETE", ...(options || {}) }),
        listPublicMeals: (options) => request("/meals/public", options),
        slotOptions: (options) => request("/slot-options", options),
        saveFeedback: (payload, options) => request("/feedback", { method: "POST", body: payload, ...(options || {}) }),
        listTraces: (params, options) => request(`/debug/traces${toQuery(params)}`, options),
        getTrace: (traceId, options) => request(`/debug/traces/${encodeURIComponent(traceId)}`, options),
        listSessionTraces: (sessionId, limit, options) => request(`/debug/sessions/${encodeURIComponent(sessionId)}/traces${toQuery({ limit })}`, options),
        labelTrace: (traceId, payload, options) => request(`/debug/traces/${encodeURIComponent(traceId)}/label`, { method: "PUT", body: payload, ...(options || {}) }),
        evaluate: (payload, options) => request("/evaluations", { method: "POST", body: payload, ...(options || {}) })
    };
})();
