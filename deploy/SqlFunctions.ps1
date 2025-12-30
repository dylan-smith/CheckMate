[Reflection.Assembly]::LoadWithPartialName("Microsoft.SqlServer.ConnectionInfo") | Out-Null
[Reflection.Assembly]::LoadWithPartialName('Microsoft.SqlServer.Smo') | Out-Null

function Execute-NonQuery
{
	param([string]$Sql, [System.Data.SqlClient.SqlConnection]$Conn)
	
	$Cmd = New-Object System.Data.SqlClient.SqlCommand
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
	param([string]$Sql, [System.Data.SqlClient.SqlConnection]$Conn)
	
	$Cmd = New-Object System.Data.SqlClient.SqlCommand
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
	param([string]$Sql, [System.Data.SqlClient.SqlConnection]$Conn)
	
    try {
		$Cmd = New-Object System.Data.SqlClient.SqlCommand
		$Cmd.Connection = $Conn
		$Cmd.CommandText = $Sql
	
		$Adapter = New-Object System.Data.SqlClient.SqlDataAdapter
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

function Get-SqlConnection
{
    param([string]$DatabaseServerName,
          [string]$DatabaseName)

    if ([string]::IsNullOrWhiteSpace($DatabaseServerName)) {
	    Write-Error "Database Server must be provided"
    }

    if ([string]::IsNullOrWhiteSpace($DatabaseName))
    {
        $ConnString = "Data Source=$DatabaseServerName;Authentication=Active Directory Default;Encrypt=True;ConnectRetryCount=4;ConnectRetryInterval=15;Connection Timeout=90;"
    } else {
        $ConnString = "Server=$DatabaseServerName;Database=$DatabaseName;Authentication=Active Directory Default;Encrypt=True;"
    }

    $RetryCount = 4
    $Retries = 0
    $RetryInterval = 15
    $Success = $false

    while ($Success -eq $false -or $Retries -gt $RetryCount)
    {
        Try
        {
            $Conn = New-Object System.Data.SqlClient.SqlConnection
            $Conn.ConnectionString = $ConnString
            Write-Verbose "Opening SQL connection to $ConnString..."
            $Conn.Open()
            $Success = $true
        }
        Catch
        {
            Write-Verbose "SQL connection failed, retrying [$Retry of $RetryCount]..."
            $Retries++
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
    param([System.Data.SqlClient.SqlConnection]$Conn)

    $ServerConnection = New-Object Microsoft.SqlServer.Management.Common.ServerConnection($Conn)
    $Server = New-Object Microsoft.SqlServer.Management.Smo.Server($ServerConnection)

    Write-Output $Server
}