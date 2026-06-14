"use client";

import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

export function ToastProvider() {
  return (
    <ToastContainer
      theme="dark"
      newestOnTop
      limit={4}
      role="status"
      aria-live="polite"
      toastClassName="watchpot-toast"
      progressClassName="watchpot-toast-progress"
      closeButton={({ closeToast }) => (
        <button
          type="button"
          onClick={closeToast}
          aria-label="Dismiss notification"
          className="watchpot-toast-close"
        >
          ×
        </button>
      )}
    />
  );
}
