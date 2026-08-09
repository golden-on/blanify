"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { apiFetch, ApiError } from "@/lib/api";

type TaskType = "cleaning" | "maintenance" | "inspection";
type TaskStatus = "pending" | "in_progress" | "completed" | "verified";

interface Task {
  id: string;
  unitId: string;
  unitName: string;
  assignedStaffId: string | null;
  staffName: string | null;
  taskType: TaskType;
  status: TaskStatus;
  dueAt: string;
  photoUrls: string[];
}

interface Unit {
  id: string;
  name: string;
  propertyName: string;
}

interface StaffMember {
  id: string;
  name: string;
  role: string;
}

const STATUS_OPTIONS: TaskStatus[] = ["pending", "in_progress", "completed", "verified"];
const TASK_TYPE_OPTIONS: TaskType[] = ["cleaning", "maintenance", "inspection"];

export default function TasksPage() {
  const { session } = useSession();
  const token = session?.token ?? null;
  const canManage = session?.role === "owner" || session?.role === "manager";

  const [tasks, setTasks] = useState<Task[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [photoUrlDrafts, setPhotoUrlDrafts] = useState<Record<string, string>>({});

  const [newTask, setNewTask] = useState({ unitId: "", assignedStaffId: "", taskType: "cleaning" as TaskType, dueAt: "" });

  const loadTasks = useCallback(async () => {
    if (!token) return;
    try {
      const body = await apiFetch<{ tasks: Task[] }>("/api/v1/host/tasks", token);
      setTasks(body.tasks);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load tasks");
    }
  }, [token]);

  const loadManagerData = useCallback(async () => {
    if (!token || !canManage) return;
    try {
      const [unitsBody, staffBody] = await Promise.all([
        apiFetch<{ units: Unit[] }>("/api/v1/host/units", token),
        apiFetch<{ staff: StaffMember[] }>("/api/v1/host/staff", token),
      ]);
      setUnits(unitsBody.units);
      setStaff(staffBody.staff);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load units/staff");
    }
  }, [token, canManage]);

  useEffect(() => {
    void loadTasks();
    void loadManagerData();
  }, [loadTasks, loadManagerData]);

  async function updateStatus(taskId: string, status: TaskStatus) {
    if (!token) return;
    try {
      await apiFetch(`/api/v1/host/tasks/${taskId}`, token, { method: "PATCH", body: JSON.stringify({ status }) });
      await loadTasks();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update task");
    }
  }

  async function addPhotoUrl(task: Task) {
    if (!token) return;
    const draft = photoUrlDrafts[task.id]?.trim();
    if (!draft) return;
    try {
      await apiFetch(`/api/v1/host/tasks/${task.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ photoUrls: [...task.photoUrls, draft] }),
      });
      setPhotoUrlDrafts((prev) => ({ ...prev, [task.id]: "" }));
      await loadTasks();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to attach photo");
    }
  }

  async function createTask() {
    if (!token || !newTask.unitId || !newTask.dueAt) return;
    try {
      await apiFetch("/api/v1/host/tasks", token, {
        method: "POST",
        body: JSON.stringify({
          unitId: newTask.unitId,
          assignedStaffId: newTask.assignedStaffId || undefined,
          taskType: newTask.taskType,
          dueAt: new Date(newTask.dueAt).toISOString(),
        }),
      });
      setNewTask({ unitId: "", assignedStaffId: "", taskType: "cleaning", dueAt: "" });
      await loadTasks();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create task");
    }
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">Tasks</h1>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {canManage && (
        <div className="mb-6 flex flex-wrap items-end gap-2 rounded-md border border-neutral-200 p-3">
          <div>
            <label className="block text-xs text-neutral-500">Unit</label>
            <select
              value={newTask.unitId}
              onChange={(e) => setNewTask((t) => ({ ...t, unitId: e.target.value }))}
              className="rounded-md border border-neutral-300 p-1.5 text-sm"
            >
              <option value="">Select a unit</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name} ({unit.propertyName})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-neutral-500">Type</label>
            <select
              value={newTask.taskType}
              onChange={(e) => setNewTask((t) => ({ ...t, taskType: e.target.value as TaskType }))}
              className="rounded-md border border-neutral-300 p-1.5 text-sm"
            >
              {TASK_TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-neutral-500">Assign to</label>
            <select
              value={newTask.assignedStaffId}
              onChange={(e) => setNewTask((t) => ({ ...t, assignedStaffId: e.target.value }))}
              className="rounded-md border border-neutral-300 p-1.5 text-sm"
            >
              <option value="">Unassigned</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} ({member.role})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-neutral-500">Due</label>
            <input
              type="datetime-local"
              value={newTask.dueAt}
              onChange={(e) => setNewTask((t) => ({ ...t, dueAt: e.target.value }))}
              className="rounded-md border border-neutral-300 p-1.5 text-sm"
            />
          </div>
          <button
            onClick={() => void createTask()}
            disabled={!newTask.unitId || !newTask.dueAt}
            className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            New task
          </button>
        </div>
      )}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-neutral-500">
            <th className="p-2">Unit</th>
            <th className="p-2">Type</th>
            <th className="p-2">Status</th>
            <th className="p-2">Assigned</th>
            <th className="p-2">Due</th>
            <th className="p-2">Photos</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} className="border-b border-neutral-100">
              <td className="p-2">{task.unitName}</td>
              <td className="p-2">{task.taskType}</td>
              <td className="p-2">
                <select
                  value={task.status}
                  onChange={(e) => void updateStatus(task.id, e.target.value as TaskStatus)}
                  className="rounded-md border border-neutral-300 p-1 text-xs"
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </td>
              <td className="p-2">{task.staffName ?? "Unassigned"}</td>
              <td className="p-2 text-xs text-neutral-500">{new Date(task.dueAt).toLocaleString()}</td>
              <td className="p-2">
                <div className="flex flex-col gap-1">
                  {task.photoUrls.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer" className="truncate text-xs text-blue-600 underline">
                      {url}
                    </a>
                  ))}
                  <div className="flex gap-1">
                    <input
                      value={photoUrlDrafts[task.id] ?? ""}
                      onChange={(e) => setPhotoUrlDrafts((prev) => ({ ...prev, [task.id]: e.target.value }))}
                      placeholder="Photo URL"
                      className="w-32 rounded-md border border-neutral-300 p-1 text-xs"
                    />
                    <button
                      onClick={() => void addPhotoUrl(task)}
                      className="rounded-md border border-neutral-300 px-2 text-xs hover:bg-neutral-50"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </td>
            </tr>
          ))}
          {tasks.length === 0 && (
            <tr>
              <td colSpan={6} className="p-3 text-sm text-neutral-400">
                No tasks yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
