import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError, fetchRecentExtractions, submitExtractionFile, submitExtractionText } from "../lib/api";
import type { ExtractionResult } from "../lib/api";

export function ExtractPage() {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const recentQuery = useQuery({ queryKey: ["extractions"], queryFn: fetchRecentExtractions });

  const mutation = useMutation({
    mutationFn: async () => {
      if (file) return submitExtractionFile(file);
      return submitExtractionText(text);
    },
    onSuccess: (data) => {
      setResult(data);
      setErrorMessage(null);
      queryClient.invalidateQueries({ queryKey: ["extractions"] });
    },
    onError: (err) => {
      setResult(null);
      setErrorMessage(err instanceof ApiRequestError ? `${err.code}: ${err.message}` : String(err));
    },
  });

  const canSubmit = (text.trim().length > 0 || file !== null) && !mutation.isPending;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-slate-900">Extract requirements</h1>
      <p className="mt-1 text-sm text-slate-500">Paste regulation text or upload a PDF to extract structured filing requirements.</p>

      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div>
          <label htmlFor="extract-text" className="block text-sm font-medium text-slate-700">
            Regulation text
          </label>
          <textarea
            id="extract-text"
            className="mt-1 h-40 w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-50"
            placeholder="Paste regulation text here…"
            value={text}
            disabled={file !== null}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        <div className="text-center text-xs text-slate-400">— or —</div>

        <div>
          <label htmlFor="extract-file" className="block text-sm font-medium text-slate-700">
            PDF upload
          </label>
          <input
            id="extract-file"
            type="file"
            accept="application/pdf"
            className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-sky-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-sky-700 hover:file:bg-sky-100"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file && (
            <button
              type="button"
              className="mt-1 text-xs text-sky-600 hover:underline"
              onClick={() => setFile(null)}
            >
              Clear file
            </button>
          )}
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {mutation.isPending ? "Extracting…" : "Extract"}
        </button>
      </form>

      {errorMessage && (
        <div className="mt-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{errorMessage}</div>
      )}

      {result && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-medium text-slate-900">
            Attempt #{result.attemptId} — {result.accepted} accepted, {result.rejected.length} rejected
          </h2>
          {result.rejected.length > 0 && (
            <ul className="mt-3 space-y-2">
              {result.rejected.map((r, idx) => (
                <li key={idx} className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <div className="font-medium">Rejected record #{idx + 1}</div>
                  <ul className="mt-1 list-inside list-disc">
                    {r.issues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-medium text-slate-900">Recent attempts</h2>
        {recentQuery.isLoading && <p className="mt-2 text-sm text-slate-500">Loading…</p>}
        {recentQuery.isError && (
          <p className="mt-2 text-sm text-red-600">Failed to load attempts: {(recentQuery.error as Error).message}</p>
        )}
        {recentQuery.data && (
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Document</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Model</th>
                  <th className="px-4 py-2">Accepted</th>
                  <th className="px-4 py-2">Rejected</th>
                  <th className="px-4 py-2">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentQuery.data.map((attempt) => (
                  <tr key={attempt.id}>
                    <td className="px-4 py-2 text-slate-900">{attempt.documentName}</td>
                    <td className="px-4 py-2 text-slate-600">{attempt.status}</td>
                    <td className="px-4 py-2 text-slate-600">{attempt.model}</td>
                    <td className="px-4 py-2 text-slate-600">{attempt.accepted}</td>
                    <td className="px-4 py-2 text-slate-600">{attempt.rejected}</td>
                    <td className="px-4 py-2 text-slate-600">{new Date(attempt.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
                {recentQuery.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                      No extraction attempts yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
