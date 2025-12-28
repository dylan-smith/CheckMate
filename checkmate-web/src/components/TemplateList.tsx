"use client";

import { Template } from "@/types/template";

interface TemplateListProps {
  templates: Template[];
  onEdit: (template: Template) => void;
  onDelete: (id: string) => void;
}

export default function TemplateList({
  templates,
  onEdit,
  onDelete,
}: TemplateListProps) {
  return (
    <div className="template-list">
      {templates.length === 0 ? (
        <p className="empty-message">
          No templates found. Create your first template!
        </p>
      ) : (
        <table className="templates-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>ID</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((template) => (
              <tr key={template.id}>
                <td>{template.name}</td>
                <td className="id-cell">{template.id}</td>
                <td className="actions-cell">
                  <button
                    onClick={() => onEdit(template)}
                    className="btn btn-small btn-edit"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onDelete(template.id)}
                    className="btn btn-small btn-delete"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
