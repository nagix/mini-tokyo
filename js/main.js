var map = L.map('map').setView([35.68, 139.75], 13);
var lineLookup = [];
var stationLookup = [];
var g;

// For development
L.DomUtil.addClass(map._container,'crosshair-cursor-enabled');

L.tileLayer('https://api.tiles.mapbox.com/v4/{id}/{z}/{x}/{y}.png?access_token=pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTA2emYycXBndHRqcmZ3N3gifQ.rJcFIG214AriISLbB6B5aw', {
	maxZoom: 18,
	attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors, ' +
		'<a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, ' +
		'Imagery &copy; <a href="https://www.mapbox.com/">Mapbox</a>',
	id: 'mapbox.streets'
}).addTo(map);

/* Initialize the SVG layer */
L.svg().addTo(map);

/* We simply pick up the SVG from the map object */
g = d3.select('#map').select('svg').select('g');

Promise.all([
	d3.json('data/lines.json'),
	d3.json('data/stations.json'),
	d3.json('data/cars.json')
]).then(function([lineData, stationData, carData]) {
	lineData.lines.forEach(function(line) {
		lineLookup[line.name] = line;
	});

	stationData.stations.forEach(function(station) {
		stationLookup[station.name] = station;
	});

	/* Add a LatLng object to each item in the dataset */
	lineData.lines.forEach(function(d) {
		d.path = d.path.map(function(point) {
			return new L.latLng(point[0], point[1]);
		});
	});

	var line = d3.line()
		.x(function(d) {
			return map.latLngToLayerPoint(d).x;
		})
		.y(function(d) {
			return map.latLngToLayerPoint(d).y;
		})
		.curve(d3.curveCardinal.tension(.4));

	update();

	initStationOffsets();

	carData.cars.forEach(function(car) {
		var stations = lineLookup[car.line].stations;
		var sectionIndex = car.sectionIndex;
		var sectionOffset = stations[sectionIndex].offset;
		var nextSectionOffset = stations[sectionIndex + car.direction].offset;
		car.sectionOffset = sectionOffset;
		car.sectionLength = nextSectionOffset - sectionOffset;
	});

	transition(g.selectAll('.car'));

	map.on('moveend', update);

	// For development
	map.on('mousemove', function(e) {
		var latlng = map.layerPointToLatLng(L.point(e.layerPoint));
		console.log([latlng.lat.toFixed(4), latlng.lng.toFixed(4)]);
	});

	function update() {
		var lines = g.selectAll('.line')
			.data(lineData.lines);
		lines.enter().append('path')
			.attr('class', function(d) { return d.name + ' line'; })
			.merge(lines)
			.attr('d', function(d) { return line(d.path); });

		// For development
		var points = g.selectAll('.point')
			.data(lineData.lines[0].path.concat(lineData.lines[1].path));
		points.enter().append("circle")
			.attr('class', 'point')
			.style('fill', 'white')
			.attr('r', 1.5)
			.merge(points)
			.attr('transform', function(d) {
				return 'translate(' +
					map.latLngToLayerPoint(d).x + ',' +
					map.latLngToLayerPoint(d).y + ')';
			});

		var cars = g.selectAll('.car')
			.data(carData.cars);
		cars.enter().append('rect')
			.attr('class', function(d) { return d.line + ' car'; })
			.attr('x', -10)
			.attr('y', -6)
			.attr('width', 20)
			.attr('height', 12)
			.attr('transform', function(d) {
				var path = g.select('.' + d.line + '.line').node();
				var p = getPointAtLengthWithRotation(path, d.sectionOffset * path.getTotalLength());
				return 'translate(' + p.x + ',' + p.y + ') rotate(' + p.angle + ')';
			});

		var stations = g.selectAll('.station')
			.data(stationData.stations)
		stations.enter().append("circle")
			.attr('class', 'station')
			.attr('r', 5)
			.merge(stations)
			.attr('transform', function(d) {
				var latlng = new L.latLng(d.coords);
				return 'translate(' +
					map.latLngToLayerPoint(latlng).x + ',' +
					map.latLngToLayerPoint(latlng).y + ')';
			});
	}

	function transition(element) {
		element.transition()
			.duration(function(d) {return d.duration * Math.abs(d.sectionLength);})
			.attrTween('transform', translateAlong)
			.on('end', function(d) {
				var stations = lineLookup[d.line].stations;
				var direction = d.direction;
				var sectionIndex = d.sectionIndex + direction;

				if (sectionIndex <= 0) {
					sectionIndex = stations.length - 1;
				} else if (sectionIndex >= stations.length - 1) {
					sectionIndex = 0;
				}

				var sectionOffset = stations[sectionIndex].offset;
				var nextSectionOffset = stations[sectionIndex + direction].offset;

				d.sectionIndex = sectionIndex;
				d.sectionOffset = sectionOffset;
				d.sectionLength = nextSectionOffset - sectionOffset;

				transition(d3.select(this));
			});
	}

	function translateAlong(d) {
		var path = g.select('.' + d.line + '.line').node();
		return function(t) {
			var l = path.getTotalLength();
			var p = getPointAtLengthWithRotation(path, (d.sectionOffset + t * d.sectionLength) * l);
			return 'translate(' + p.x + ',' + p.y + ') rotate(' + p.angle + ')';
		};
	}

	function getPointAtLengthWithRotation(path, length) {
		var p1 = path.getPointAtLength(length)
		var p2 = path.getPointAtLength(length + 1)
		var deg = Math.atan2(p1.y - p2.y, p1.x - p2.x) * (180 / Math.PI);
		return {
			x: p1.x,
			y: p1.y,
			angle: deg
		}
	}

	function initStationOffsets() {
		lineData.lines.forEach(function(line) {
			var totalLength = g.select('.' + line.name + '.line').node().getTotalLength();
			line.stations.forEach(function(station, i, stations) {
				var length = getLengthAtPoint(line.path, stationLookup[station.name].coords);
				station.offset = length / totalLength;
			});
		});

		// Temporary workaround
		lineData.lines[0].stations[29].offset = 1;
	}

	function getLengthAtPoint(path, coords) {
		var subpath = [];
		var i, latlng, selection;

		for (i = 0; i < path.length; ++i) {
			latlng = path[i];
			if (latlng.lat === coords[0] && latlng.lng === coords[1]) {
				subpath = path.slice(0, i + 1);
				break;
			}
		}
		selection = g.selectAll('.subpath')
			.data([subpath]);
		selection.enter().append('path')
			.attr('class', 'subpath')
			.merge(selection)
			.attr('d', line);

		return g.selectAll('.subpath').node().getTotalLength();
	}
});
