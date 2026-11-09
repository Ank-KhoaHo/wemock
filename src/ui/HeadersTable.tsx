import { useEffect, useState } from 'react';

export interface HeadersTableProps {
  headers: Record<string, string>;
  onChange: (headers: Record<string, string>) => void;
}

interface HeaderPair {
  id: string;
  name: string;
  value: string;
}

export function HeadersTable({ headers, onChange }: HeadersTableProps) {
  const [pairs, setPairs] = useState<HeaderPair[]>(() => {
    const entries = Object.entries(headers);
    if (entries.length === 0) {
      return [{ id: '0', name: '', value: '' }];
    }
    return entries.map(([name, value], idx) => ({
      id: String(idx),
      name,
      value,
    }));
  });

  // Sync internal state when external headers change meaningfully
  useEffect(() => {
    const currentObj: Record<string, string> = {};
    for (const p of pairs) {
      if (p.name.trim()) {
        currentObj[p.name.toLowerCase().trim()] = p.value;
      }
    }
    const incomingEntries = Object.entries(headers);
    const hasDiff =
      incomingEntries.length !== Object.keys(currentObj).length ||
      incomingEntries.some(([k, v]) => currentObj[k.toLowerCase()] !== v);

    if (hasDiff) {
      if (incomingEntries.length === 0) {
        setPairs([{ id: String(Date.now()), name: '', value: '' }]);
      } else {
        setPairs(
          incomingEntries.map(([name, value], idx) => ({
            id: `${idx}-${name}`,
            name,
            value,
          })),
        );
      }
    }
  }, [headers]);

  const emitChange = (updatedPairs: HeaderPair[]) => {
    setPairs(updatedPairs);
    const result: Record<string, string> = {};
    for (const p of updatedPairs) {
      const trimmedName = p.name.trim();
      if (trimmedName) {
        result[trimmedName.toLowerCase()] = p.value;
      }
    }
    onChange(result);
  };

  const handleNameChange = (id: string, name: string) => {
    const updated = pairs.map((p) => (p.id === id ? { ...p, name } : p));
    emitChange(updated);
  };

  const handleValueChange = (id: string, value: string) => {
    const updated = pairs.map((p) => (p.id === id ? { ...p, value } : p));
    emitChange(updated);
  };

  const handleRemove = (id: string) => {
    const updated = pairs.filter((p) => p.id !== id);
    emitChange(updated);
  };

  const handleAdd = () => {
    const updated = [...pairs, { id: String(Date.now()), name: '', value: '' }];
    emitChange(updated);
  };

  return (
    <div className="headers-table-container">
      <div className="headers-table-header">
        <label className="field-label">Headers</label>
        <button
          type="button"
          data-testid="header-add"
          className="header-add-btn"
          onClick={handleAdd}
        >
          + Add header
        </button>
      </div>

      <div className="headers-table-rows">
        {pairs.map((p) => (
          <div key={p.id} data-testid="header-row" className="header-row">
            <input
              type="text"
              data-testid="header-name"
              className="header-name-input"
              placeholder="Name"
              value={p.name}
              onChange={(e) => handleNameChange(p.id, e.target.value)}
            />
            <input
              type="text"
              data-testid="header-value"
              className="header-value-input"
              placeholder="Value"
              value={p.value}
              onChange={(e) => handleValueChange(p.id, e.target.value)}
            />
            <button
              type="button"
              data-testid="header-remove"
              className="header-remove-btn"
              onClick={() => handleRemove(p.id)}
              title="Remove header"
              aria-label="Remove this header"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default HeadersTable;
