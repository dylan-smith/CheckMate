using CheckMate.WebApi.Data;
using CheckMate.WebApi.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;

namespace CheckMate.WebApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class TemplatesController(ApplicationDbContext context) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IEnumerable<Template>>> GetTemplates()
    {
        return await context.Templates.ToListAsync();
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<Template>> GetTemplate(Guid id)
    {
        var template = await context.Templates.FindAsync(id);

        if (template == null)
        {
            return NotFound();
        }

        return template;
    }

    [HttpPost]
    public async Task<ActionResult<Template>> CreateTemplate(Template template)
    {
        if (template.Id == Guid.Empty)
        {
            template.Id = Guid.NewGuid();
        }

        context.Templates.Add(template);
        await context.SaveChangesAsync();

        return CreatedAtAction(nameof(GetTemplate), new { id = template.Id }, template);
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> UpdateTemplate(Guid id, Template template)
    {
        if (id != template.Id)
        {
            return BadRequest();
        }

        context.Entry(template).State = EntityState.Modified;

        try
        {
            await context.SaveChangesAsync();
        }
        catch (DbUpdateConcurrencyException)
        {
            if (!await TemplateExists(id))
            {
                return NotFound();
            }
            else
            {
                throw;
            }
        }

        return NoContent();
    }

    [Authorize(Roles = "admin")]
    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteTemplate(Guid id)
    {
        var template = await context.Templates.FindAsync(id);
        if (template == null)
        {
            return NotFound();
        }

        context.Templates.Remove(template);
        await context.SaveChangesAsync();

        return NoContent();
    }

    private async Task<bool> TemplateExists(Guid id)
    {
        return await context.Templates.AnyAsync(e => e.Id == id);
    }
}
