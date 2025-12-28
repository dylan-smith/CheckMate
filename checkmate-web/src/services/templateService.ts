import { Template } from '@/types/template';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5167';

export const templateService = {
  async getAll(): Promise<Template[]> {
    const response = await fetch(`${API_BASE_URL}/api/templates`);
    if (!response.ok) {
      throw new Error('Failed to fetch templates');
    }
    return response.json();
  },

  async getById(id: string): Promise<Template> {
    const response = await fetch(`${API_BASE_URL}/api/templates/${id}`);
    if (!response.ok) {
      throw new Error('Failed to fetch template');
    }
    return response.json();
  },

  async create(template: Omit<Template, 'id'>): Promise<Template> {
    const response = await fetch(`${API_BASE_URL}/api/templates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: '00000000-0000-0000-0000-000000000000', ...template }),
    });
    if (!response.ok) {
      throw new Error('Failed to create template');
    }
    return response.json();
  },

  async update(id: string, template: Template): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/templates/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(template),
    });
    if (!response.ok) {
      throw new Error('Failed to update template');
    }
  },

  async delete(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/templates/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to delete template');
    }
  },
};
