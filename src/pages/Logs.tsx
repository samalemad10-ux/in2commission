import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import Layout from "@/components/Layout";

export default function Logs() {
  const { data: logs, isLoading } = useQuery({
    queryKey: ["commission-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("commission_run_logs")
        .select("*")
        .order("run_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold text-foreground">Commission Logs</h2>
          <p className="mt-2 text-muted-foreground">View historical commission calculations</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Runs</CardTitle>
            <CardDescription>Last 50 commission calculations</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div>Loading...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run Date</TableHead>
                    <TableHead>Rep Name</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Total Commission</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs?.map((log) => {
                    const commission = log.commission_json as any;
                    return (
                      <TableRow key={log.id}>
                        <TableCell>{format(new Date(log.run_date), "PPP p")}</TableCell>
                        <TableCell>{log.rep_name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{log.team}</Badge>
                        </TableCell>
                        <TableCell>
                          {format(new Date(log.period_start), "MMM d")} -{" "}
                          {format(new Date(log.period_end), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell className="font-semibold">
                          ${commission?.totalCommission?.toLocaleString() || 0}
                        </TableCell>
                        <TableCell>
                          {log.success ? (
                            <Badge variant="default" className="bg-success">Success</Badge>
                          ) : (
                            <Badge variant="destructive">Failed</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
