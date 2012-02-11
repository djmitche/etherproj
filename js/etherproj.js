etherproj = {
    version: 1.0,
};

// Top-level interface

etherproj.Project = function() {
    this.displays = [];
    this.data = { tasks: [] };
}

// watch a textarea element and parse the text from it
etherproj.Project.prototype.watch_text = function(selector, delay) {
    var self = this;
    var timer_id = null;

    var update =  function() {
        timer_id = null;
        self.set_text($(selector).val()); // TODO: jQuery-ism
    };

    var changed = function() {
        if (timer_id) {
            window.clearTimeout(timer_id);
        }
        timer_id = window.setTimeout(update, delay);
    };

    var elt = d3.select(selector);
    elt.on('change', changed);
    elt.on('input', changed);
    elt.on('propertychange', changed);

    // update (almost) immediately
    $(document).ready(update); // TODO: jQuery-ism
};

// add a div in which to display a gantt chart
etherproj.Project.prototype.display_gantt = function(selector) {
    this.displays.push(new etherproj.Gantt(this, selector));
};

// display based on the given text
etherproj.Project.prototype.set_text = function(selector) {
    this.data = this.solve(this.parse_text(selector));
    $.each(this.displays, function(i, d) { d.redraw(); }) // TODO: jQuery-ism
};

// Parser

etherproj.Project.prototype.parse_text = function(text) {
    var options = {gantt: {}};
    var options_stanza = function(name) {
        // TODO: verify this is a valid option stanza name
        var current_opts = options[name];

        return function(setting, value) {
            // TODO: verify this is a valid value
            current_opts[setting] = value;
        };
    };

    var tasks = [];
    var task_stanza = function(name) {
        task = {
            name: name,
            // default values
            title: name,
            duration: 1,
            constraints: [],
        };
        tasks.push(task)

        return function(setting, value) {
            if (setting === 'title') {
                task.title = value;
            } else if (setting === 'duration') {
                // TODO: assumes days as unit
                task.duration = etherproj.safeParseInt(value, 1);
            } else if (setting === 'when') {
                task.when = Date.parse(value);
                // TODO: error handling
            } else if (setting === 'after') {
                task.constraints.push({ type: 'prereq', name: etherproj.strip(value) })
            }
            // TODO: error handling
        };
    };

    var stanza_fns = {
        options: options_stanza,
        task: task_stanza,
    };

    var stanza_re = new RegExp("^(task|options)\\s+(.*):$");
    var setting_re = new RegExp("^\\s+(\\S+)\\s*:\\s*(.*)$");
    var comment_re = new RegExp("#.*$");
    var ws_re = new RegExp("^\\s*$");

    var lines = text.split("\n");
    var nlines = lines.length;
    var matches;
    var setting_fn;
    for (var i = 0; i < nlines; i++) {
        var line = lines[i];

        // strip comments and skip all-whitespace lines
        line = line.replace(comment_re, '');
        if (ws_re.exec(line)) {
            continue;
        }

        // check for a new stanza header
        if (matches = stanza_re.exec(line)) {
            var name = etherproj.strip(matches[2]);
            setting_fn = stanza_fns[matches[1]](name);
            continue;
        }

        // ..and for settings
        if (setting_fn && (matches = setting_re.exec(line))) {
            setting_fn(matches[1], matches[2]);
            continue;
        }

        // TODO: flag this line as an error in the HTML
        console.log("ERROR:", line);

        // reset the task so later settings do not apply to the wrong task
        setting_fn = null;
    }

    return {
        tasks: tasks,
        options: options,
    };
}

// Solver

etherproj.Project.prototype.solve = function(parsed_data) {
    var tasks = parsed_data.tasks;
    var ntasks = parsed_data.tasks.length;

    // get the tasks keyed by name, for easy dependency-finding
    var by_name = {__proto__:null};
    for (var i = 0; i < ntasks; i++) {
        var t = tasks[i];
        by_name[t.name] = t;
    }

    // connections between tasks, each represented as a tuple of nodes (before,
    // after)
    var connections = [];

    var start = Date.today();

    // now visit all nodes, using depth-first searching
    var visit = function(n) {
        if (n.visited) {
            return;
        }
        n.visited = true;

        // allowed range
        var earliest = n.when || start.clone();

        // TODO: stack to prevent loops

        // visit constraints
        var nconst = n.constraints.length;
        for (var i = 0; i < nconst; i++) {
            var c = n.constraints[i];
            if (c.type === 'prereq') {
                var pq = by_name[c.name];
                if (pq) {
                    visit(pq);
                    if (earliest.compareTo(pq.end) < 0) {
                        earliest = pq.end;
                    }
                    connections.push([pq, n]);
                } else {
                    // TODO report error
                }
            }
        }
        n.when = earliest;
        n.end = earliest.clone().add(n.duration).days();
    }
    for (var i = 0; i < ntasks; i++) {
        visit(tasks[i]);
    }

    // sort by 'when', and use that to define the order
    tasks.sort(function (a,b) {
        return a.when - b.when || b.duration - a.duration;
    });

    for (var i = 0; i < ntasks; i++) {
        tasks[i].order = i;
    }

    console.log(tasks);

    return {
        tasks: tasks,
        connections: connections,
    };
}

// Gantt chart display

etherproj.Gantt = function(proj, selector) {
    this.proj = proj;

    // parameters
    this.row_height = 20;
    this.transition_duration = 500;
    this.width = 500;

    this.div = d3.select(selector)
        .attr("width", this.width);
    this.svg = this.div.append("svg")
         .attr("class", "etherproj-gantt")
         .attr("width", this.width);
    this.axis_g = this.svg.insert('g').attr('class', 'axis');
    this.content_g = this.svg.insert('g')
        .attr('transform', 'translate(0, 18)'); // move content down
    this.tasks_g = this.content_g.insert('g').attr('class', 'tasks');
    this.conns_g = this.content_g.insert('g').attr('class', 'conns');
};

etherproj.Gantt.prototype.redraw = function() {
    var self = this;

    // X axis scales along available dates
    var min_date, max_date;
    if (self.proj.data.tasks.length > 1) {
        min_date = new Date(d3.min(self.proj.data.tasks, function(d) { return +(d.when); }));
        max_date = new Date(d3.max(self.proj.data.tasks, function(d) { return +(d.end); }));
    } else {
        min_date = Date.parse('yesterday');
        max_date = Date.parse('tomorrow');
    }
    var x = d3.time.scale().domain([min_date, max_date]).range([0, self.width]);

    // Y axis is based on task order
    var max_order;
    if (self.proj.data.tasks.length > 0) {
        max_order = d3.max(self.proj.data.tasks, function(d) { return d.order; });
    } else {
        max_order = 1;
    }
    var y = d3.scale.linear().domain([0, max_order]).range([0, self.row_height * max_order]);

    self.redraw_axis(x, y);
    self.redraw_tasks(x, y);
    self.redraw_conns(x, y);
};

etherproj.Gantt.prototype.redraw_axis = function(x,  y) {
    var self = this;
    var axis = d3.svg.axis().scale(x).ticks(this.width / 50).tickSize(4, 2, 0);

    this.axis_g.transition()
        .duration(self.transition_duration)
        .call(axis);
}

etherproj.Gantt.prototype.redraw_tasks = function(x,  y) {
    var self = this;

    var task_x = function(d) { return x(d.when); };
    var task_y = function(d) { return y(d.order); };

    var box_height = self.row_height - 2;
    var text_func = function(d) { return d.title };
    var width_func = function(d) { return x(d.end) - x(d.when); };

    var taskgs = self.tasks_g.selectAll("g").filter('.task')
        .data(self.proj.data.tasks, function(d) { return d.name });
    var taskgs_enter = taskgs.enter().insert("g")
        .attr('class', 'task');
    var taskgs_exit = taskgs.exit();

    // functions to set/update values on each shape
    var box_fn = function(sel, include_fixed) {
        if (include_fixed) {
            sel .attr("height", box_height)
                .attr("rx", 3)
                .attr("ry", 3);
        }
        sel .attr("x", task_x)
            .attr("y", task_y)
            .attr("width", width_func);
    };
    var text_fn = function(sel, include_fixed) {
        if (include_fixed) {
            sel .attr("dx", 3)
                .attr("dy", self.row_height - 7);
        }
        sel .attr("x", task_x)
            .attr("y", task_y)
            .text(text_func);
    };

    // enter - fade in
    taskgs_enter
        .style("fill-opacity", 0)
        .style("stroke-opacity", 0)
      .transition()
        .duration(this.transition_duration)
        .style("fill-opacity", 1.0)
        .style("stroke-opacity", 1.0);

    box_fn(taskgs_enter.insert("rect"), true);
    text_fn(taskgs_enter.insert("text"), true);

    // update - move to new shape
    taskgs.transition()
        .duration(this.transition_duration)
        .style("fill-opacity", 1.0)
        .style("stroke-opacity", 1.0);

    box_fn(taskgs.select("rect").transition()
            .duration(this.transition_duration));
    text_fn(taskgs.select("text").transition()
        .duration(this.transition_duration));

    // exit -- fade taskgs to nothing and remove
    taskgs_exit.transition()
        .duration(this.transition_duration)
        .style("fill-opacity", 0)
        .style("stroke-opacity", 0)
        .remove();
};

etherproj.Gantt.prototype.redraw_conns = function(x,  y) {
    var self = this;

    var conn_path_fn = function(d) {
        var before = d[0], after = d[1];

        // Draw a two-segment bezier curve, stopping off at the midpoint
        // beteween the start and end.  The control points are over the
        // midpoint, unless the start and end times are the same, in which case
        // they're a few units before/after
        var few_units = 15;
        
        var bx = x(before.end);
        var by = y(before.order + 0.5);
        var ax = x(after.when);
        var ay = y(after.order + 0.5);

        // halfway point
        var hx = (ax + bx) / 2;
        var hy = (ay + by) / 2;

        // and the X coordinate of the control point
        var cx = hx;
        if (cx < bx + few_units / 2) {
            cx = bx + few_units / 2;
        } else if (cx > bx + 3 * few_units) {
            cx = bx + 3 * few_units;
        }

        var pt = function(x,y) { return x + "," + y; };

        return "M" + pt(bx,by) + " Q" + pt(cx, by) + " " + pt(hx, hy) + " T" + pt(ax,ay);
    };

    var conns = self.conns_g.selectAll("path").filter('.conn')
        .data(self.proj.data.connections, function(d) { return d[0].name + '|' + d[1].name; });
    var conns_enter = conns.enter().insert("path")
        .attr('class', 'conn');
    var conns_exit = conns.exit();

    conns_enter
        .style("stroke-opacity", 0)
        .attr('d', conn_path_fn)
      .transition()
        .duration(this.transition_duration)
        .style("stroke-opacity", 0.6);

    conns.transition()
        .duration(this.transition_duration)
        .attr('d', conn_path_fn)
        .style("stroke-opacity", 0.6);

    conns_exit.transition()
        .duration(this.transition_duration)
        .style("stroke-opacity", 0)
        .remove();
};

// Utilities

etherproj.safeParseInt = function(s, d) {
    var v = parseInt(s);
    if (isNaN(v)) {
        return d;
    }
    return v;
};

etherproj.strip = function(s) {
    return s.replace(/^\s+|\s+$/g, '');
}
