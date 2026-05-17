import { useState } from "react";
import { Plus, Save, Trash2, Folder, Pin, Check } from "lucide-react";
import type { WorkspaceSpace } from "../../../../shared/types";
import { useAppStore } from "../../../store";
import { ConfirmCard } from "../ConfirmCard";
import { NoticeCard } from "../NoticeCard";
import { cn } from "../../DashboardPrimitives";

export function SpacesPanel(props: { onSelect: (path: string) => void }) {
  const store = useAppStore();
  const spaces = store.webUiOverview?.spaces ?? [];
  const [editing, setEditing] = useState<Partial<WorkspaceSpace> | undefined>();
  const [confirming, setConfirming] = useState<WorkspaceSpace | undefined>();
  const [message, setMessage] = useState("");

  async function refresh() {
    store.setWebUiOverview(await window.workbenchClient.getWebUiOverview());
  }

  async function saveSpace() {
    if (!editing?.path?.trim()) return;
    await window.workbenchClient.saveSpace({
      id: editing.id,
      name: editing.name?.trim() || undefined,
      path: editing.path.trim(),
      description: editing.description,
      pinned: Boolean(editing.pinned),
    });
    setEditing(undefined);
    setMessage("工作区已保存。");
    await refresh();
  }

  async function deleteSpace(space: WorkspaceSpace) {
    await window.workbenchClient.deleteSpace(space.id);
    setConfirming(undefined);
    setMessage("工作区已删除。");
    await refresh();
  }

  async function togglePinned(space: WorkspaceSpace) {
    await window.workbenchClient.saveSpace({ ...space, pinned: !space.pinned });
    await refresh();
  }

  const pinned = spaces.filter((s) => s.pinned);
  const unpinned = spaces.filter((s) => !s.pinned);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Folder size={14} />
          <span>管理常用工作区路径。</span>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700 hover:shadow-md active:scale-[0.98]"
          onClick={() => setEditing({ path: "", name: "", description: "", pinned: false })}
          type="button"
        >
          <Plus size={14} />
          添加工作区
        </button>
      </div>

      {message ? <NoticeCard text={message} onClose={() => setMessage("")} /> : null}
      {confirming ? <ConfirmCard title={`删除工作区：${confirming.name}`} body="仅从列表中移除，不会删除实际文件。" tone="danger" onCancel={() => setConfirming(undefined)} onConfirm={() => void deleteSpace(confirming)} /> : null}

      {editing ? (
        <section className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400">名称</label>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-1 ring-transparent transition-all focus:border-indigo-400 focus:ring-indigo-100"
                placeholder="工作区名称"
                value={editing.name ?? ""}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400">路径</label>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono outline-none ring-1 ring-transparent transition-all focus:border-indigo-400 focus:ring-indigo-100"
                placeholder="/path/to/workspace"
                value={editing.path ?? ""}
                onChange={(event) => setEditing({ ...editing, path: event.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400">描述</label>
            <textarea
              className="h-20 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-1 ring-transparent transition-all focus:border-indigo-400 focus:ring-indigo-100 resize-none"
              placeholder="描述这个工作区的用途..."
              value={editing.description ?? ""}
              onChange={(event) => setEditing({ ...editing, description: event.target.value })}
            />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <button
              aria-pressed={Boolean(editing.pinned)}
              className="flex items-center gap-2 text-sm text-slate-600"
              onClick={() => setEditing({ ...editing, pinned: !editing.pinned })}
              type="button"
            >
              <span className={cn("relative h-5 w-9 rounded-full transition", editing.pinned ? "bg-slate-950" : "bg-slate-200")}>
                <span className={cn("absolute top-1 h-3 w-3 rounded-full bg-white shadow-sm transition", editing.pinned ? "left-5" : "left-1")} />
              </span>
              置顶
            </button>
            <div className="flex gap-2">
              <button
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100"
                onClick={() => setEditing(undefined)}
                type="button"
              >
                取消
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700"
                onClick={() => void saveSpace()}
                type="button"
              >
                <Save size={14} />
                保存
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {pinned.length ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Pin size={12} className="text-amber-500" />
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">置顶</span>
          </div>
          {pinned.map((space) => (
            <WorkspaceItem key={space.id} space={space} onSelect={() => props.onSelect(space.path)} onEdit={() => setEditing({ ...space })} onDelete={() => setConfirming(space)} onTogglePin={() => void togglePinned(space)} pinned />
          ))}
        </div>
      ) : null}

      {unpinned.length ? (
        <div className="space-y-3">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-400">工作区</span>
          {unpinned.map((space) => (
            <WorkspaceItem key={space.id} space={space} onSelect={() => props.onSelect(space.path)} onEdit={() => setEditing({ ...space })} onDelete={() => setConfirming(space)} onTogglePin={() => void togglePinned(space)} />
          ))}
        </div>
      ) : null}

      {spaces.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-slate-100">
            <Folder size={28} className="text-slate-400" />
          </div>
          <p className="mt-4 text-sm text-slate-500">暂无工作区</p>
          <p className="mt-1 text-xs text-slate-400">添加后会保存到配置中</p>
          <button
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700"
            onClick={() => setEditing({ path: "", name: "", description: "", pinned: false })}
            type="button"
          >
            <Plus size={14} />
            添加第一个工作区
          </button>
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceItem(props: { space: WorkspaceSpace; onSelect: () => void; onEdit: () => void; onDelete: () => void; onTogglePin: () => void; pinned?: boolean }) {
  return (
    <section className="group flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 shadow-sm transition-all hover:border-slate-200 hover:shadow-md">
      <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-lg bg-amber-100">
        <Folder size={18} className="text-amber-600" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-slate-900">{props.space.name}</h3>
          {props.pinned && <Pin size={12} className="text-amber-500" />}
        </div>
        <p className="mt-0.5 text-xs text-slate-400 font-mono truncate">{props.space.path}</p>
        {props.space.description && (
          <p className="mt-1 text-xs text-slate-500">{props.space.description}</p>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          className="grid h-7 w-7 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          title="置顶"
          onClick={props.onTogglePin}
          type="button"
        >
          <Pin size={13} />
        </button>
        <button
          className="grid h-7 w-7 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          title="编辑"
          onClick={props.onEdit}
          type="button"
        >
          <Save size={13} />
        </button>
        <button
          className="grid h-7 w-7 place-items-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
          title="删除"
          onClick={props.onDelete}
          type="button"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <button
        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
        onClick={props.onSelect}
        type="button"
      >
        <Check size={12} />
        选择
      </button>
    </section>
  );
}
