using CheckMate.Api.Authentication;
using CheckMate.Api.Contracts;
using Microsoft.AspNetCore.Mvc;

namespace CheckMate.Api.Controllers;

/// <summary>
/// The signed-in user, so the frontend can check a saved sign-in is still good.
/// </summary>
[ApiController]
[Route("api/me")]
public class MeController : ControllerBase
{
    [HttpGet]
    public ActionResult<MeResponse> Get()
    {
        return Ok(new MeResponse(
            User.FindFirst(AuthenticationSetup.NameClaim)?.Value,
            User.FindFirst(AuthenticationSetup.EmailClaim)?.Value));
    }
}
