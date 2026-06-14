import { toast, type Id, type ToastOptions } from "react-toastify";
import { errorMessage } from "@/lib/api";

const baseOptions: ToastOptions = {
  position: "top-right",
  autoClose: 4500,
  hideProgressBar: false,
  closeOnClick: true,
  pauseOnHover: true,
  draggable: true,
  draggablePercent: 40,
};

function show(
  type: "success" | "error" | "info" | "warning",
  message: string,
  options?: ToastOptions,
): Id {
  const text = message.trim();
  if (!text) return "";
  return toast[type](text, { ...baseOptions, ...options });
}

export const notify = {
  success: (message: string, options?: ToastOptions) => show("success", message, options),
  error: (message: string, options?: ToastOptions) => show("error", message, options),
  info: (message: string, options?: ToastOptions) => show("info", message, options),
  warning: (message: string, options?: ToastOptions) => show("warning", message, options),
  apiError: (error: unknown, fallback = "Request failed", options?: ToastOptions) =>
    show("error", errorMessage(error, fallback), options),
  dismiss: (id?: Id) => toast.dismiss(id),
};
