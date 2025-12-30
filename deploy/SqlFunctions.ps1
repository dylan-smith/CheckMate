# Ensure SqlServer module is available (includes Microsoft.Data.SqlClient)
if (-not (Get-Module -ListAvailable -Name SqlServer)) {
    Write-Verbose "Installing SqlServer module..."
    Install-Module -Name SqlServer -Force -AllowClobber -Scope CurrentUser
}

Import-Module SqlServer -ErrorAction SilentlyContinue

# Load required assemblies
[Reflection.Assembly]::LoadWithPartialName("Microsoft.SqlServer.ConnectionInfo") | Out-Null
[Reflection.Assembly]::LoadWithPartialName('Microsoft.SqlServer.Smo') | Out-Null

function Execute-NonQuery
{
	param([string]$Sql, [Microsoft.Data.SqlClient.SqlConnection]$Conn)
	
	$Cmd = New-Object Microsoft.Data.SqlClient.SqlCommand
	$Cmd.Connection = $Conn
	$Cmd.CommandText = $Sql
    $Cmd.CommandTimeout = 600
	
	try {
        Write-Verbose "Executing $Sql"
		$Cmd.ExecuteNonQuery() | Out-Null
	}
	catch [System.Exception] {
		Write-Error $_.Exception.InnerException.Message
	}
}

function Execute-Scalar
{
	param([string]$Sql, [Microsoft.Data.SqlClient.SqlConnection]$Conn)
	
	$Cmd = New-Object Microsoft.Data.SqlClient.SqlCommand
	$Cmd.Connection = $Conn
	$Cmd.CommandText = $Sql
	
	try {
		Write-Output $Cmd.ExecuteScalar()
	}
	catch [System.Exception] {
		Write-Error $_.Exception.InnerException.Message
	}
}

function Get-DataTable
{
	param([string]$Sql, [Microsoft.Data.SqlClient.SqlConnection]$Conn)
	
    try {
		$Cmd = New-Object Microsoft.Data.SqlClient.SqlCommand
		$Cmd.Connection = $Conn
		$Cmd.CommandText = $Sql
	
		$Adapter = New-Object Microsoft.Data.SqlClient.SqlDataAdapter
		$Adapter.SelectCommand = $Cmd

		$Result = New-Object System.Data.DataTable
		$Adapter.Fill($Result) | Out-Null

		Write-Output -NoEnumerate $Result
	}
	catch [System.Exception] {
		Write-Error $_.Exception.InnerException.Message
	}
}

function Execute-SQLCMD
{
	param([string]$Sql, [Microsoft.SqlServer.Management.Smo.Server]$Server)
	
	try {
		$Server.ConnectionContext.ExecuteNonQuery($Sql) | Out-Null
	}
	catch [System.Exception] {
		Write-Error $_.Exception.InnerException.Message
	}
}

function Decode-JwtPayload {
    param([string]$Jwt)

    $payload = $Jwt.Split('.')[1]
    $payload += '=' * ((4 - $payload.Length % 4) % 4)
    $bytes = [Convert]::FromBase64String($payload.Replace('-', '+').Replace('_', '/'))
    $json = [System.Text.Encoding]::UTF8.GetString($bytes)
    return $json | ConvertFrom-Json
}

function Get-SqlConnection
{
    param([string]$DatabaseServerName,
          [string]$DatabaseName)

    if ([string]::IsNullOrWhiteSpace($DatabaseServerName)) {
	    Write-Error "Database Server must be provided"
    }

    $token = az account get-access-token --resource https://database.windows.net/ --query accessToken -o tsv

    $claims = Decode-JwtPayload $token

    $claims | Format-List

    if ([string]::IsNullOrWhiteSpace($token)) {
        Write-Error "Failed to acquire access token for Azure SQL Database"
    }

    if ([string]::IsNullOrWhiteSpace($DatabaseName))
    {
        $ConnString = "Server=$DatabaseServerName;Encrypt=True;"
    } else {
        $ConnString = "Server=$DatabaseServerName;Database=$DatabaseName;Encrypt=True;"
    }

    $RetryCount = 4
    $Retries = 0
    $RetryInterval = 15
    $Success = $false

    while ($Success -eq $false -and $Retries -lt $RetryCount)
    {
        Try
        {
            Write-Verbose "Opening SQL connection to $ConnString..."
            $Conn = New-Object Microsoft.Data.SqlClient.SqlConnection
            $Conn.ConnectionString = $ConnString
            $Conn.AccessToken = $token
            Write-Verbose "Opening SQL connection to $ConnString...2"
            $Conn.Open()
            $Success = $true
        }
        Catch
        {
            $Retries++
            Write-Verbose $_.Exception.Message
            if ($_.Exception.InnerException) {
                Write-Verbose $_.Exception.InnerException.Message
            }
            Write-Verbose "SQL connection failed, retrying [$Retries of $RetryCount]..."
            Start-Sleep -s $RetryInterval
        }
    }

    if ($Success -eq $true)
    {
        Write-Output $Conn
    } else {
        Write-Error "Failed to connect to SQL Server"
    }
}

function Get-SmoServer
{
    param([Microsoft.Data.SqlClient.SqlConnection]$Conn)

    $ServerConnection = New-Object Microsoft.SqlServer.Management.Common.ServerConnection($Conn)
    $Server = New-Object Microsoft.SqlServer.Management.Smo.Server($ServerConnection)

    Write-Output $Server
}