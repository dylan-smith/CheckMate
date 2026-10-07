-- Creates the preview web app's database user for its managed identity, with the same roles as production's
-- (db_datareader and db_datawriter). The user is created from its SID rather than FROM EXTERNAL PROVIDER, which
-- would need the SQL server's identity to read Microsoft Entra ID. Azure SQL derives an application's SID from
-- its client (application) ID, so that's what AppSid holds.
--
-- Run as the server's Entra admin by azure/sql-action, with the sqlcmd variables AppUserName (the web app's
-- name) and AppSid (the client ID of its system-assigned identity). A reopened PR gets a new identity under the
-- same name, so a user with a different SID is replaced.
DECLARE @sid varbinary(16) = CAST(CAST('$(AppSid)' AS uniqueidentifier) AS varbinary(16));

IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(AppUserName)' AND sid <> @sid)
    DROP USER [$(AppUserName)];

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(AppUserName)')
BEGIN
    -- CREATE USER takes a literal SID, not a variable.
    DECLARE @sql nvarchar(max) = N'CREATE USER ' + QUOTENAME(N'$(AppUserName)')
        + N' WITH SID = ' + CONVERT(nvarchar(34), @sid, 1) + N', TYPE = E;';
    EXEC sys.sp_executesql @sql;
END;

IF IS_ROLEMEMBER('db_datareader', N'$(AppUserName)') = 0
    ALTER ROLE db_datareader ADD MEMBER [$(AppUserName)];

IF IS_ROLEMEMBER('db_datawriter', N'$(AppUserName)') = 0
    ALTER ROLE db_datawriter ADD MEMBER [$(AppUserName)];
