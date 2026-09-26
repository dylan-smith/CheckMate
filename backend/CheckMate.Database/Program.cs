using CheckMate.Database;

if (args.Length == 0)
{
    Console.ForegroundColor = ConsoleColor.Red;
    Console.WriteLine("Usage: CheckMate.Database <connection-string>");
    Console.ResetColor();
    return -1;
}

try
{
    DbUpRunner.Run(args[0]);
    return 0;
}
// codeql[cs/catch-of-all-exceptions] Top-level handler for the migration tool: report any failure and exit non-zero.
catch (Exception ex)
{
    Console.ForegroundColor = ConsoleColor.Red;
    Console.WriteLine(ex);
    Console.ResetColor();
    return -1;
}
