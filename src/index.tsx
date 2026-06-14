import ReactDOM from "react-dom/client";
import "@xyflow/react/dist/style.css";
import App from "./App";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
    throw new Error("Missing #app root");
}

ReactDOM.createRoot(root).render(<App />);
