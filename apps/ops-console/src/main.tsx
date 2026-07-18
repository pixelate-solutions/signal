import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { OpsAuthProvider } from "./auth";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Signal Control root element is missing.");

createRoot(root).render(
  <StrictMode>
    <OpsAuthProvider>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { refetchInterval: 10_000, retry: 1 } } })
        }
      >
        <App />
      </QueryClientProvider>
    </OpsAuthProvider>
  </StrictMode>,
);
