import "./styles.css";
import { createRoot } from "react-dom/client";
import App from "./app";

const container = document.getElementById("root");
if (!container) {
  console.error("Failed to find root element with id 'root'");
} else {
  const root = createRoot(container);
  root.render(<App />);
}
