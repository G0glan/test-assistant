import ChatPanel from "./components/ChatPanel/ChatPanel";
import Dashboard from "./components/Dashboard/Dashboard";
import TaskEditor from "./components/TaskEditor/TaskEditor";

function currentView(): "chat" | "dashboard" | "task-editor" {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  if (view === "dashboard" || view === "task-editor") {
    return view;
  }
  return "chat";
}

export default function App() {
  const view = currentView();
  if (view === "dashboard") {
    return <Dashboard />;
  }
  if (view === "task-editor") {
    return <TaskEditor />;
  }
  return <ChatPanel />;
}
